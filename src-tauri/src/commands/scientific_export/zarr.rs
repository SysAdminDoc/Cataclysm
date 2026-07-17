use super::*;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use zarrs::array::{ArrayBuilder, ZARR_NAN_F32, data_type};
use zarrs::storage::ReadableWritableListableStorage;

pub(super) struct ZarrArtifactStats {
    pub bytes: u64,
    pub files: u64,
}

fn attributes(entries: &[(&str, Value)]) -> Map<String, Value> {
    entries
        .iter()
        .map(|(name, value)| ((*name).to_string(), value.clone()))
        .collect()
}

fn write_f64_coordinate(
    store: ReadableWritableListableStorage,
    name: &str,
    values: &[f64],
    attrs: Map<String, Value>,
) -> Result<(), String> {
    let mut builder = ArrayBuilder::new(
        vec![values.len() as u64],
        vec![values.len().min(256) as u64],
        data_type::float64(),
        f64::NAN,
    );
    builder.dimension_names(Some([name])).attributes(attrs);
    let array = builder
        .build(store, &format!("/{name}"))
        .map_err(|error| format!("failed to define Zarr coordinate '{name}': {error}"))?;
    array
        .store_metadata()
        .map_err(|error| format!("failed to store Zarr coordinate metadata '{name}': {error}"))?;
    let subset = array.subset_all();
    array
        .store_array_subset(&subset, values)
        .map_err(|error| format!("failed to store Zarr coordinate '{name}': {error}"))
}

fn write_f32_grid(
    store: ReadableWritableListableStorage,
    name: &str,
    shape: &[u64],
    dimensions: &[&str],
    values: &[f32],
    attrs: Map<String, Value>,
) -> Result<(), String> {
    let chunks: Vec<u64> = shape
        .iter()
        .map(|size| if *size == 1 { 1 } else { (*size).min(256) })
        .collect();
    let mut builder = ArrayBuilder::new(shape.to_vec(), chunks, data_type::float32(), ZARR_NAN_F32);
    builder
        .dimension_names(Some(dimensions.iter().copied()))
        .attributes(attrs);
    let array = builder
        .build(store, &format!("/{name}"))
        .map_err(|error| format!("failed to define Zarr variable '{name}': {error}"))?;
    array
        .store_metadata()
        .map_err(|error| format!("failed to store Zarr metadata '{name}': {error}"))?;
    let ranges: Vec<_> = shape.iter().map(|size| 0..*size).collect();
    array
        .store_array_subset(&ranges, values)
        .map_err(|error| format!("failed to store Zarr variable '{name}': {error}"))
}

fn field_attributes(
    dimensions: &[&str],
    long_name: &str,
    units: &str,
    standard_name: Option<&str>,
    extra: &[(&str, Value)],
) -> Map<String, Value> {
    let mut attrs = attributes(&[
        ("long_name", json!(long_name)),
        ("units", json!(units)),
        ("grid_mapping", json!("crs")),
        ("_ARRAY_DIMENSIONS", json!(dimensions)),
    ]);
    if let Some(standard_name) = standard_name {
        attrs.insert("standard_name".into(), json!(standard_name));
    }
    for (name, value) in extra {
        attrs.insert((*name).into(), value.clone());
    }
    attrs
}

fn store_stats(path: &Path) -> Result<ZarrArtifactStats, String> {
    fn visit(path: &Path, bytes: &mut u64, files: &mut u64) -> Result<(), String> {
        for entry in
            fs::read_dir(path).map_err(|error| format!("failed to inspect Zarr store: {error}"))?
        {
            let entry = entry.map_err(|error| format!("failed to inspect Zarr store: {error}"))?;
            let metadata = entry
                .metadata()
                .map_err(|error| format!("failed to inspect Zarr store: {error}"))?;
            if metadata.is_dir() {
                visit(&entry.path(), bytes, files)?;
            } else if metadata.is_file() {
                *bytes = bytes.saturating_add(metadata.len());
                *files = files.saturating_add(1);
            }
        }
        Ok(())
    }

    let mut bytes = 0;
    let mut files = 0;
    visit(path, &mut bytes, &mut files)?;
    Ok(ZarrArtifactStats { bytes, files })
}

pub(super) fn write_scientific_zarr(
    path: &Path,
    run_id: &str,
    req: &SimulateGridRequest,
    grid: &SwGrid,
    max_field: &MaxFieldAccumulator,
    run_quality: &RunQualityRecord,
    used_gpu: bool,
) -> Result<ZarrArtifactStats, String> {
    let cells = validate_export_shape(grid)?;
    let [peak_m, t_of_max_s, arrival_s, energy_m2s] = max_field.scientific_fields();
    if [peak_m, t_of_max_s, arrival_s, energy_m2s]
        .iter()
        .any(|field| field.len() != cells)
    {
        return Err("scientific export rejected: max-field shape does not match the grid".into());
    }

    let canonical_request = serde_json::to_vec(req)
        .map_err(|error| format!("failed to serialize Zarr provenance: {error}"))?;
    let scenario_sha256 = crate::render_protocol::sha256_hex(&canonical_request);
    let scenario_json = String::from_utf8(canonical_request)
        .map_err(|error| format!("failed to encode Zarr provenance: {error}"))?;
    let quality_json = serde_json::to_string(run_quality)
        .map_err(|error| format!("failed to serialize Zarr quality: {error}"))?;
    let bathymetry_source = if req.use_real_bathymetry {
        if req.bathymetry_asset_id.is_some() {
            "validated user-supplied scientific raster"
        } else {
            "bundled coarse basin/shelf bathymetry"
        }
    } else {
        "uniform analytical depth from the scenario request"
    };

    let store: ReadableWritableListableStorage = Arc::new(
        zarrs::filesystem::FilesystemStore::new(path)
            .map_err(|error| format!("failed to create Zarr store: {error}"))?,
    );
    let mut group = zarrs::group::GroupBuilder::new()
        .build(store.clone(), "/")
        .map_err(|error| format!("failed to define Zarr root group: {error}"))?;
    for (name, value) in [
        ("Conventions", json!("Zarr 3.1; CF-1.12 metadata")),
        ("title", json!("Cataclysm shallow-water solver products")),
        ("institution", json!("SysAdminDoc / Cataclysm Project")),
        (
            "source",
            json!(format!(
                "Cataclysm {} finite-volume shallow-water solver",
                env!("CARGO_PKG_VERSION")
            )),
        ),
        (
            "history",
            json!(format!(
                "Generated by Cataclysm {}",
                env!("CARGO_PKG_VERSION")
            )),
        ),
        ("cataclysm_run_id", json!(run_id)),
        ("cataclysm_scenario_sha256", json!(scenario_sha256)),
        ("cataclysm_scenario_json", json!(scenario_json)),
        ("cataclysm_bathymetry_source", json!(bathymetry_source)),
        (
            "cataclysm_solver_backend",
            json!(if used_gpu {
                "wgpu with CPU fallback"
            } else {
                "CPU rayon"
            }),
        ),
        (
            "cataclysm_horizontal_crs",
            json!("WGS 84 geographic coordinates (EPSG:4326)"),
        ),
        (
            "cataclysm_vertical_datum",
            json!("mean sea level; modeled sea-surface displacement"),
        ),
        ("cataclysm_quality_record", json!(quality_json)),
        (
            "crs",
            json!({
                "grid_mapping_name": "latitude_longitude",
                "semi_major_axis": 6378137.0,
                "inverse_flattening": 298.257223563,
                "longitude_of_prime_meridian": 0.0
            }),
        ),
    ] {
        group.attributes_mut().insert(name.into(), value);
    }
    if let Some(asset_id) = req.bathymetry_asset_id.as_deref() {
        group
            .attributes_mut()
            .insert("cataclysm_bathymetry_asset_id".into(), json!(asset_id));
    }
    group
        .store_metadata()
        .map_err(|error| format!("failed to store Zarr root metadata: {error}"))?;

    let time = [grid.t_s];
    let latitudes: Vec<f64> = (0..grid.ny)
        .map(|j| grid.south_lat + (j as f64 + 0.5) * grid.dlat_deg)
        .collect();
    let longitudes: Vec<f64> = (0..grid.nx)
        .map(|i| grid.west_lon + (i as f64 + 0.5) * grid.dlon_deg)
        .collect();
    write_f64_coordinate(
        store.clone(),
        "time",
        &time,
        attributes(&[
            ("standard_name", json!("time")),
            ("long_name", json!("simulation time")),
            ("units", json!("seconds since 1970-01-01 00:00:00 UTC")),
            ("calendar", json!("proleptic_gregorian")),
            ("axis", json!("T")),
            ("_ARRAY_DIMENSIONS", json!(["time"])),
        ]),
    )?;
    for (name, values, standard_name, units, axis, long_name) in [
        (
            "latitude",
            latitudes.as_slice(),
            "latitude",
            "degrees_north",
            "Y",
            "cell-center latitude",
        ),
        (
            "longitude",
            longitudes.as_slice(),
            "longitude",
            "degrees_east",
            "X",
            "cell-center longitude",
        ),
    ] {
        write_f64_coordinate(
            store.clone(),
            name,
            values,
            attributes(&[
                ("standard_name", json!(standard_name)),
                ("long_name", json!(long_name)),
                ("units", json!(units)),
                ("axis", json!(axis)),
                ("_ARRAY_DIMENSIONS", json!([name])),
            ]),
        )?;
    }

    let state_shape = [1, grid.ny as u64, grid.nx as u64];
    let grid_shape = [grid.ny as u64, grid.nx as u64];
    let state_dims = ["time", "latitude", "longitude"];
    let grid_dims = ["latitude", "longitude"];
    for (name, values, long_name, units, standard_name, extra) in [
        (
            "sea_surface_height",
            grid.eta_m.as_slice(),
            "final sea-surface displacement",
            "m",
            Some("sea_surface_height_above_sea_level"),
            vec![("positive", json!("up"))],
        ),
        (
            "eastward_sea_water_velocity",
            grid.u_ms.as_slice(),
            "final eastward depth-averaged sea-water velocity",
            "m s-1",
            Some("eastward_sea_water_velocity"),
            vec![],
        ),
        (
            "northward_sea_water_velocity",
            grid.v_ms.as_slice(),
            "final northward depth-averaged sea-water velocity",
            "m s-1",
            Some("northward_sea_water_velocity"),
            vec![],
        ),
    ] {
        write_f32_grid(
            store.clone(),
            name,
            &state_shape,
            &state_dims,
            &f32_field(values),
            field_attributes(&state_dims, long_name, units, standard_name, &extra),
        )?;
    }
    let arrival: Vec<f32> = arrival_s
        .iter()
        .map(|value| {
            if value.is_finite() {
                *value as f32
            } else {
                f32::NAN
            }
        })
        .collect();
    for (name, values, long_name, units, standard_name, extra) in [
        (
            "sea_floor_depth",
            f32_field(&grid.h_m),
            "sea-floor depth below mean sea level",
            "m",
            Some("sea_floor_depth_below_mean_sea_level"),
            vec![("positive", json!("down"))],
        ),
        (
            "maximum_absolute_sea_surface_height",
            f32_field(peak_m),
            "maximum absolute sea-surface displacement",
            "m",
            None,
            vec![
                ("cell_methods", json!("time: maximum")),
                ("coordinates", json!("time")),
            ],
        ),
        (
            "time_of_maximum_sea_surface_height",
            f32_field(t_of_max_s),
            "time of maximum absolute sea-surface displacement",
            "s",
            None,
            vec![],
        ),
        (
            "first_arrival_time",
            arrival,
            "first threshold-crossing arrival time",
            "s",
            None,
            vec![(
                "comment",
                json!(
                    "Threshold is max(1 cm, 1 percent of source amplitude); NaN indicates no threshold crossing."
                ),
            )],
        ),
        (
            "time_integrated_squared_sea_surface_height",
            f32_field(energy_m2s),
            "time integral of squared sea-surface displacement",
            "m2 s",
            None,
            vec![],
        ),
    ] {
        write_f32_grid(
            store.clone(),
            name,
            &grid_shape,
            &grid_dims,
            &values,
            field_attributes(&grid_dims, long_name, units, standard_name, &extra),
        )?;
    }

    store_stats(path)
}
