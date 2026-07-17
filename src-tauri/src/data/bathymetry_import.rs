//! Fail-closed preflight for user-supplied scientific bathymetry rasters.
//!
//! Preflight is intentionally read-only. It verifies the file format, bounds,
//! CRS/datum/axis/units, finite data range, declared rights, and digest before a
//! later cache/import step is allowed to mutate app data.

use std::{
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
};

use geotiff_reader::GeoTiffFile;
use netcdf_reader::{NcFile, NcVariable};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_IMPORT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_IMPORT_CELLS: u64 = 16_777_216;
const MAX_TEXT_BYTES: usize = 512;
const MAX_ABS_ELEVATION_M: f64 = 12_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BathymetrySampleSemantics {
    DepthPositiveDown,
    ElevationPositiveUp,
}

impl BathymetrySampleSemantics {
    fn cf_positive(self) -> &'static str {
        match self {
            Self::DepthPositiveDown => "down",
            Self::ElevationPositiveUp => "up",
        }
    }

    fn to_depth_m(self, value: f64) -> f64 {
        match self {
            Self::DepthPositiveDown => value,
            Self::ElevationPositiveUp => -value,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BathymetryPreflightRequest {
    pub path: String,
    pub variable: Option<String>,
    pub source_label: String,
    pub rights_statement: String,
    pub sample_semantics: BathymetrySampleSemantics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BathymetryRasterFormat {
    GeoTiff,
    NetCdf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BathymetryPreflight {
    pub format: BathymetryRasterFormat,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub sha256: String,
    pub source_label: String,
    pub rights_statement: String,
    pub variable: String,
    pub width: u32,
    pub height: u32,
    pub bounds_wgs84: [f64; 4],
    pub resolution_deg: [f64; 2],
    pub horizontal_crs: String,
    pub vertical_datum: String,
    pub units: String,
    pub sample_semantics: BathymetrySampleSemantics,
    pub nodata: Option<f64>,
    pub valid_cell_count: u64,
    pub nodata_cell_count: u64,
    pub wet_cell_count: u64,
    pub dry_cell_count: u64,
    pub min_depth_m: f64,
    pub max_depth_m: f64,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct RasterCore {
    variable: String,
    width: u32,
    height: u32,
    bounds_wgs84: [f64; 4],
    resolution_deg: [f64; 2],
    horizontal_crs: String,
    vertical_datum: String,
    units: String,
    nodata: Option<f64>,
    values: Vec<f64>,
    warnings: Vec<String>,
}

fn bounded_text(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    if value.len() > MAX_TEXT_BYTES {
        return Err(format!("{label} exceeds {MAX_TEXT_BYTES} UTF-8 bytes"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} contains control characters"));
    }
    Ok(value.to_owned())
}

fn canonical_input(path: &str) -> Result<(PathBuf, u64), String> {
    if path.trim().is_empty() || path.len() > 32_768 || path.contains('\0') {
        return Err("bathymetry path is invalid".into());
    }
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|error| format!("bathymetry file is unavailable: {error}"))?;
    let metadata = canonical
        .metadata()
        .map_err(|error| format!("bathymetry metadata is unavailable: {error}"))?;
    if !metadata.is_file() {
        return Err("bathymetry path must identify one regular file".into());
    }
    if metadata.len() == 0 || metadata.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "bathymetry file must be between 1 byte and {MAX_IMPORT_BYTES} bytes"
        ));
    }
    Ok((canonical, metadata.len()))
}

pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
    let mut reader = BufReader::new(
        File::open(path).map_err(|error| format!("bathymetry file could not be read: {error}"))?,
    );
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| format!("bathymetry checksum failed: {error}"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn detect_format(path: &Path) -> Result<BathymetryRasterFormat, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "tif" | "tiff" => Ok(BathymetryRasterFormat::GeoTiff),
        "nc" | "cdf" | "nc4" => Ok(BathymetryRasterFormat::NetCdf),
        _ => Err("bathymetry file must use .tif, .tiff, .nc, .cdf, or .nc4".into()),
    }
}

fn checked_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width < 2 || height < 2 {
        return Err("bathymetry raster must contain at least 2×2 cells".into());
    }
    let cells = u64::from(width) * u64::from(height);
    if cells > MAX_IMPORT_CELLS {
        return Err(format!(
            "bathymetry raster exceeds the {MAX_IMPORT_CELLS}-cell limit"
        ));
    }
    Ok(())
}

fn read_geotiff_values(file: &GeoTiffFile) -> Result<Vec<f64>, String> {
    let ifd = file
        .tiff()
        .ifds()
        .iter()
        .find(|ifd| ifd.width() == file.width() && ifd.height() == file.height())
        .ok_or_else(|| "GeoTIFF base image metadata is unavailable".to_owned())?;
    let bits = *ifd
        .bits_per_sample()
        .first()
        .ok_or_else(|| "GeoTIFF BitsPerSample is unavailable".to_owned())?;
    let sample_format = *ifd
        .sample_format()
        .first()
        .ok_or_else(|| "GeoTIFF SampleFormat is unavailable".to_owned())?;

    macro_rules! read_as_f64 {
        ($ty:ty) => {{
            file.read_band::<$ty>(0)
                .map(|array| array.iter().map(|value| *value as f64).collect())
                .map_err(|error| format!("GeoTIFF raster decoding failed: {error}"))
        }};
    }

    match (sample_format, bits) {
        (1, 8) => read_as_f64!(u8),
        (1, 16) => read_as_f64!(u16),
        (1, 32) => read_as_f64!(u32),
        (2, 8) => read_as_f64!(i8),
        (2, 16) => read_as_f64!(i16),
        (2, 32) => read_as_f64!(i32),
        (3, 32) => read_as_f64!(f32),
        (3, 64) => read_as_f64!(f64),
        _ => Err(format!(
            "GeoTIFF sample encoding is unsupported (SampleFormat={sample_format}, BitsPerSample={bits})"
        )),
    }
}

fn preflight_geotiff(
    path: &Path,
    semantics: BathymetrySampleSemantics,
) -> Result<RasterCore, String> {
    let file = GeoTiffFile::open(path)
        .map_err(|error| format!("GeoTIFF metadata could not be decoded: {error}"))?;
    checked_dimensions(file.width(), file.height())?;
    if file.band_count() != 1 {
        return Err("GeoTIFF bathymetry must contain exactly one raster band".into());
    }
    if file.epsg() != Some(4326) {
        return Err("GeoTIFF horizontal CRS must be EPSG:4326 (WGS 84 geographic)".into());
    }
    let transform = file
        .transform()
        .ok_or_else(|| "GeoTIFF must include an affine georeferencing transform".to_owned())?;
    if transform.skew_x.abs() > 1e-12
        || transform.skew_y.abs() > 1e-12
        || transform.pixel_width <= 0.0
        || transform.pixel_height >= 0.0
    {
        return Err(
            "GeoTIFF must be an unrotated north-up grid with positive longitude spacing".into(),
        );
    }
    let bounds = file
        .geo_bounds()
        .ok_or_else(|| "GeoTIFF geographic bounds are unavailable".to_owned())?;
    validate_bounds(bounds)?;

    let crs = file.crs();
    let expected_vertical_epsg = match semantics {
        BathymetrySampleSemantics::DepthPositiveDown => 5715,
        BathymetrySampleSemantics::ElevationPositiveUp => 5714,
    };
    if crs.vertical_epsg() != Some(expected_vertical_epsg) || crs.vertical_units() != Some(9001) {
        return Err(format!(
            "GeoTIFF must declare EPSG:{expected_vertical_epsg} with metre vertical units for the selected sample convention"
        ));
    }
    let nodata = file
        .nodata()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite());
    let mut warnings = Vec::new();
    if file.nodata().is_some() && nodata.is_none() {
        return Err("GeoTIFF GDAL_NODATA must be one finite numeric value".into());
    }
    if nodata.is_none() {
        warnings.push("NoData is not declared; every finite cell will be treated as data.".into());
    }

    Ok(RasterCore {
        variable: "band_1".into(),
        width: file.width(),
        height: file.height(),
        bounds_wgs84: bounds,
        resolution_deg: [transform.pixel_width, -transform.pixel_height],
        horizontal_crs: "EPSG:4326".into(),
        vertical_datum: format!("EPSG:{expected_vertical_epsg}"),
        units: "m".into(),
        nodata,
        values: read_geotiff_values(&file)?,
        warnings,
    })
}

fn attr_string(variable: &NcVariable, name: &str) -> Option<String> {
    variable.attribute(name)?.value.as_string()
}

fn attr_number(variable: &NcVariable, name: &str) -> Option<f64> {
    variable.attribute(name)?.value.as_f64()
}

fn global_string(file: &NcFile, names: &[&str]) -> Option<String> {
    let attributes = file.global_attributes().ok()?;
    names.iter().find_map(|name| {
        attributes
            .iter()
            .find(|attribute| attribute.name.eq_ignore_ascii_case(name))
            .and_then(|attribute| attribute.value.as_string())
    })
}

fn is_coordinate(variable: &NcVariable, standard_name: &str, units: &str) -> bool {
    variable.ndim() == 1
        && (variable.name().eq_ignore_ascii_case(standard_name)
            || attr_string(variable, "standard_name")
                .is_some_and(|value| value.eq_ignore_ascii_case(standard_name)))
        && attr_string(variable, "units").is_some_and(|value| value.eq_ignore_ascii_case(units))
}

fn coordinate_step(values: &[f64], label: &str) -> Result<f64, String> {
    if values.len() < 2 || values.iter().any(|value| !value.is_finite()) {
        return Err(format!(
            "NetCDF {label} coordinate must contain finite values"
        ));
    }
    let step = values[1] - values[0];
    if step == 0.0 {
        return Err(format!(
            "NetCDF {label} coordinate must be strictly monotonic"
        ));
    }
    let tolerance = step.abs().max(1.0) * 1e-8;
    if values
        .windows(2)
        .any(|pair| ((pair[1] - pair[0]) - step).abs() > tolerance)
    {
        return Err(format!(
            "NetCDF {label} coordinate must be regularly spaced"
        ));
    }
    Ok(step)
}

fn select_netcdf_variable<'a>(
    file: &'a NcFile,
    requested: Option<&str>,
) -> Result<&'a NcVariable, String> {
    let variables = file
        .variables()
        .map_err(|error| format!("NetCDF variables could not be read: {error}"))?;
    if let Some(name) = requested {
        return variables
            .iter()
            .find(|variable| variable.name() == name)
            .ok_or_else(|| format!("NetCDF variable {name:?} does not exist"));
    }
    let mut candidates = variables.iter().filter(|variable| {
        if variable.ndim() != 2 {
            return false;
        }
        let name = variable.name().to_ascii_lowercase();
        let standard = attr_string(variable, "standard_name")
            .unwrap_or_default()
            .to_ascii_lowercase();
        matches!(name.as_str(), "depth" | "elevation" | "bathymetry" | "z")
            || matches!(
                standard.as_str(),
                "sea_floor_depth_below_geoid" | "sea_floor_depth" | "surface_altitude"
            )
    });
    let selected = candidates.next().ok_or_else(|| {
        "NetCDF has no unambiguous 2-D bathymetry variable; select one explicitly".to_owned()
    })?;
    if candidates.next().is_some() {
        return Err(
            "NetCDF has multiple bathymetry candidates; select a variable explicitly".into(),
        );
    }
    Ok(selected)
}

fn preflight_netcdf(
    path: &Path,
    requested_variable: Option<&str>,
    semantics: BathymetrySampleSemantics,
) -> Result<RasterCore, String> {
    let file =
        NcFile::open(path).map_err(|error| format!("NetCDF could not be decoded: {error}"))?;
    let conventions = global_string(&file, &["Conventions"])
        .ok_or_else(|| "NetCDF must declare a CF Conventions version".to_owned())?;
    if !conventions
        .split_whitespace()
        .any(|entry| entry.to_ascii_uppercase().starts_with("CF-"))
    {
        return Err("NetCDF Conventions must include an explicit CF version".into());
    }
    let variable = select_netcdf_variable(&file, requested_variable)?;
    let shape = variable.shape();
    if shape.len() != 2 {
        return Err("NetCDF bathymetry variable must be two-dimensional".into());
    }
    let variables = file
        .variables()
        .map_err(|error| format!("NetCDF variables could not be read: {error}"))?;
    let lat = variables
        .iter()
        .find(|candidate| is_coordinate(candidate, "latitude", "degrees_north"))
        .ok_or_else(|| {
            "NetCDF requires a 1-D CF latitude coordinate in degrees_north".to_owned()
        })?;
    let lon = variables
        .iter()
        .find(|candidate| is_coordinate(candidate, "longitude", "degrees_east"))
        .ok_or_else(|| {
            "NetCDF requires a 1-D CF longitude coordinate in degrees_east".to_owned()
        })?;
    let lat_values: Vec<f64> = file
        .read_variable_as_f64(lat.name())
        .map_err(|error| format!("NetCDF latitude could not be read: {error}"))?
        .iter()
        .copied()
        .collect();
    let lon_values: Vec<f64> = file
        .read_variable_as_f64(lon.name())
        .map_err(|error| format!("NetCDF longitude could not be read: {error}"))?
        .iter()
        .copied()
        .collect();
    let lat_step = coordinate_step(&lat_values, "latitude")?;
    let lon_step = coordinate_step(&lon_values, "longitude")?;
    let dimension_names: Vec<&str> = variable
        .dimensions()
        .iter()
        .map(|dimension| dimension.name.as_str())
        .collect();
    let lat_dimension = lat
        .coordinate_dimension()
        .ok_or_else(|| "NetCDF latitude must be a coordinate variable".to_owned())?
        .name
        .as_str();
    let lon_dimension = lon
        .coordinate_dimension()
        .ok_or_else(|| "NetCDF longitude must be a coordinate variable".to_owned())?
        .name
        .as_str();
    let (height, width) = match dimension_names.as_slice() {
        [lat_name, lon_name] if *lat_name == lat_dimension && *lon_name == lon_dimension => {
            (shape[0], shape[1])
        }
        [lon_name, lat_name] if *lat_name == lat_dimension && *lon_name == lon_dimension => {
            (shape[1], shape[0])
        }
        _ => {
            return Err(
                "NetCDF bathymetry dimensions must be the CF latitude/longitude coordinates".into(),
            );
        }
    };
    let width = u32::try_from(width).map_err(|_| "NetCDF longitude dimension is too large")?;
    let height = u32::try_from(height).map_err(|_| "NetCDF latitude dimension is too large")?;
    checked_dimensions(width, height)?;

    let units = attr_string(variable, "units").unwrap_or_default();
    if !matches!(
        units.trim().to_ascii_lowercase().as_str(),
        "m" | "metre" | "meter" | "metres" | "meters"
    ) {
        return Err("NetCDF bathymetry units must be metres".into());
    }
    let positive = attr_string(variable, "positive").ok_or_else(|| {
        "NetCDF bathymetry must declare CF positive=up or positive=down".to_owned()
    })?;
    if !positive.eq_ignore_ascii_case(semantics.cf_positive()) {
        return Err(format!(
            "NetCDF positive={positive:?} conflicts with the selected {:?} convention",
            semantics
        ));
    }
    let datum = global_string(&file, &["geospatial_vertical_datum", "vertical_datum"])
        .ok_or_else(|| "NetCDF must declare geospatial_vertical_datum".to_owned())?;
    let normalized_datum = datum.to_ascii_lowercase();
    if !(normalized_datum.contains("mean sea level") || normalized_datum.contains("msl")) {
        return Err("NetCDF vertical datum must explicitly identify mean sea level".into());
    }

    let min_lon = lon_values.iter().copied().fold(f64::INFINITY, f64::min) - lon_step.abs() / 2.0;
    let max_lon =
        lon_values.iter().copied().fold(f64::NEG_INFINITY, f64::max) + lon_step.abs() / 2.0;
    let min_lat = lat_values.iter().copied().fold(f64::INFINITY, f64::min) - lat_step.abs() / 2.0;
    let max_lat =
        lat_values.iter().copied().fold(f64::NEG_INFINITY, f64::max) + lat_step.abs() / 2.0;
    let bounds = [min_lon, min_lat, max_lon, max_lat];
    validate_bounds(bounds)?;

    let nodata =
        attr_number(variable, "_FillValue").or_else(|| attr_number(variable, "missing_value"));
    let values = file
        .read_variable_unpacked_masked(variable.name())
        .map_err(|error| format!("NetCDF bathymetry variable could not be read: {error}"))?
        .iter()
        .copied()
        .collect();
    let mut warnings = Vec::new();
    if nodata.is_none() {
        warnings.push("NoData is not declared; every finite cell will be treated as data.".into());
    }

    Ok(RasterCore {
        variable: variable.name().into(),
        width,
        height,
        bounds_wgs84: bounds,
        resolution_deg: [lon_step.abs(), lat_step.abs()],
        horizontal_crs: "EPSG:4326".into(),
        vertical_datum: datum,
        units: "m".into(),
        nodata,
        values,
        warnings,
    })
}

fn validate_bounds(bounds: [f64; 4]) -> Result<(), String> {
    if bounds.iter().any(|value| !value.is_finite())
        || bounds[0] < -180.000_001
        || bounds[2] > 180.000_001
        || bounds[1] < -90.000_001
        || bounds[3] > 90.000_001
        || bounds[0] >= bounds[2]
        || bounds[1] >= bounds[3]
    {
        return Err("bathymetry bounds must be finite WGS 84 longitude/latitude extents".into());
    }
    Ok(())
}

fn summarize_values(
    values: &[f64],
    nodata: Option<f64>,
    semantics: BathymetrySampleSemantics,
) -> Result<(u64, u64, u64, u64, f64, f64), String> {
    let mut valid = 0_u64;
    let mut missing = 0_u64;
    let mut wet = 0_u64;
    let mut dry = 0_u64;
    let mut min_depth = f64::INFINITY;
    let mut max_depth = f64::NEG_INFINITY;
    for &raw in values {
        if !raw.is_finite() || nodata.is_some_and(|value| raw == value) {
            missing += 1;
            continue;
        }
        if raw.abs() > MAX_ABS_ELEVATION_M {
            return Err(format!(
                "bathymetry contains an out-of-range value {raw} m (limit ±{MAX_ABS_ELEVATION_M} m)"
            ));
        }
        valid += 1;
        let depth = semantics.to_depth_m(raw);
        min_depth = min_depth.min(depth);
        max_depth = max_depth.max(depth);
        if depth > 0.0 {
            wet += 1;
        } else {
            dry += 1;
        }
    }
    if valid == 0 || wet == 0 {
        return Err("bathymetry contains no finite positive water-depth cells".into());
    }
    Ok((valid, missing, wet, dry, min_depth, max_depth))
}

#[tauri::command]
pub fn preflight_bathymetry_import(
    req: BathymetryPreflightRequest,
) -> Result<BathymetryPreflight, String> {
    let source_label = bounded_text(&req.source_label, "source_label")?;
    let rights_statement = bounded_text(&req.rights_statement, "rights_statement")?;
    let (path, file_size_bytes) = canonical_input(&req.path)?;
    let format = detect_format(&path)?;
    let sha256 = sha256_file(&path)?;
    let core = match format {
        BathymetryRasterFormat::GeoTiff => preflight_geotiff(&path, req.sample_semantics)?,
        BathymetryRasterFormat::NetCdf => {
            preflight_netcdf(&path, req.variable.as_deref(), req.sample_semantics)?
        }
    };
    let expected_cells = u64::from(core.width) * u64::from(core.height);
    if core.values.len() as u64 != expected_cells {
        return Err("bathymetry decoded cell count does not match its declared dimensions".into());
    }
    let (valid, missing, wet, dry, min_depth, max_depth) =
        summarize_values(&core.values, core.nodata, req.sample_semantics)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("bathymetry")
        .to_owned();

    Ok(BathymetryPreflight {
        format,
        file_name,
        file_size_bytes,
        sha256,
        source_label,
        rights_statement,
        variable: core.variable,
        width: core.width,
        height: core.height,
        bounds_wgs84: core.bounds_wgs84,
        resolution_deg: core.resolution_deg,
        horizontal_crs: core.horizontal_crs,
        vertical_datum: core.vertical_datum,
        units: core.units,
        sample_semantics: req.sample_semantics,
        nodata: core.nodata,
        valid_cell_count: valid,
        nodata_cell_count: missing,
        wet_cell_count: wet,
        dry_cell_count: dry,
        min_depth_m: min_depth,
        max_depth_m: max_depth,
        warnings: core.warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use geotiff_writer::GeoTiffBuilder;
    use ndarray::Array2;
    use netcdf3::{DataSet, FileWriter, Variable, Version};
    use tempfile::tempdir;

    fn request(path: &Path, semantics: BathymetrySampleSemantics) -> BathymetryPreflightRequest {
        BathymetryPreflightRequest {
            path: path.to_string_lossy().into_owned(),
            variable: None,
            source_label: "Local test bathymetry".into(),
            rights_statement: "User-supplied test data; redistribution not requested".into(),
            sample_semantics: semantics,
        }
    }

    #[test]
    fn geotiff_preflight_reports_contract_and_digest() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("depth.tif");
        let data =
            Array2::from_shape_vec((2, 3), vec![100.0_f32, 200.0, -1.0, 300.0, 400.0, 500.0])
                .unwrap();
        GeoTiffBuilder::new(3, 2)
            .epsg(4326)
            .vertical_epsg(5715)
            .vertical_datum(5100)
            .vertical_units(9001)
            .vertical_citation("Mean Sea Level depth")
            .pixel_scale(1.0, 1.0)
            .origin(-3.0, 2.0)
            .nodata("-1")
            .write_2d(&path, data.view())
            .unwrap();

        let report = preflight_bathymetry_import(request(
            &path,
            BathymetrySampleSemantics::DepthPositiveDown,
        ))
        .unwrap();
        assert_eq!(report.format, BathymetryRasterFormat::GeoTiff);
        assert_eq!(report.bounds_wgs84, [-3.0, 0.0, 0.0, 2.0]);
        assert_eq!(report.valid_cell_count, 5);
        assert_eq!(report.nodata_cell_count, 1);
        assert_eq!(report.max_depth_m, 500.0);
        assert_eq!(report.sha256.len(), 64);
    }

    #[test]
    fn netcdf_preflight_requires_and_reports_cf_metadata() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("depth.nc");
        let mut data_set = DataSet::new();
        data_set.add_fixed_dim("lat", 2).unwrap();
        data_set.add_fixed_dim("lon", 3).unwrap();
        data_set
            .add_global_attr_string("Conventions", "CF-1.13")
            .unwrap();
        data_set
            .add_global_attr_string("geospatial_vertical_datum", "Mean Sea Level")
            .unwrap();
        data_set.add_var_f64("lat", &["lat"]).unwrap();
        data_set.add_var_f64("lon", &["lon"]).unwrap();
        data_set.add_var_f64("depth", &["lat", "lon"]).unwrap();
        for (name, standard, units) in [
            ("lat", "latitude", "degrees_north"),
            ("lon", "longitude", "degrees_east"),
        ] {
            let variable: &mut Variable = data_set.get_var_mut(name).unwrap();
            variable.add_attr_string("standard_name", standard).unwrap();
            variable.add_attr_string("units", units).unwrap();
        }
        {
            let variable = data_set.get_var_mut("depth").unwrap();
            variable
                .add_attr_string("standard_name", "sea_floor_depth_below_geoid")
                .unwrap();
            variable.add_attr_string("units", "m").unwrap();
            variable.add_attr_string("positive", "down").unwrap();
            variable.add_attr_f64("_FillValue", vec![-9999.0]).unwrap();
        }
        let mut writer = FileWriter::open(&path).unwrap();
        writer.set_def(&data_set, Version::Classic, 0).unwrap();
        writer.write_var_f64("lat", &[0.5, 1.5]).unwrap();
        writer.write_var_f64("lon", &[-2.5, -1.5, -0.5]).unwrap();
        writer
            .write_var_f64("depth", &[100.0, 200.0, 300.0, 400.0, -9999.0, 500.0])
            .unwrap();
        writer.close().unwrap();

        let report = preflight_bathymetry_import(request(
            &path,
            BathymetrySampleSemantics::DepthPositiveDown,
        ))
        .unwrap();
        assert_eq!(report.format, BathymetryRasterFormat::NetCdf);
        assert_eq!(report.bounds_wgs84, [-3.0, 0.0, 0.0, 2.0]);
        assert_eq!(report.variable, "depth");
        assert_eq!(report.valid_cell_count, 5);
        assert_eq!(report.nodata_cell_count, 1);
    }

    #[test]
    fn preflight_rejects_missing_rights_before_reading_the_file() {
        let mut req = request(
            Path::new("does-not-exist.tif"),
            BathymetrySampleSemantics::DepthPositiveDown,
        );
        req.rights_statement.clear();
        assert!(
            preflight_bathymetry_import(req)
                .unwrap_err()
                .contains("rights_statement")
        );
    }
}
