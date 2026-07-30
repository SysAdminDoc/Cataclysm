use super::{
    SCIENTIFIC_EXPORT_MAX_CELLS, ScientificExportContext, ScientificVtkDescriptor, export_root,
    validate_export_shape,
};
use crate::physics::solver::SwGrid;
use crate::physics::solver::quality::{QualityBaseline, RunQualityRecord, RunQualityStatus};
use base64::Engine;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

const VTK_ARRAY_COUNT: u64 = 6;
const VTK_MAX_FRAMES: usize = 240;
const VTK_MAX_BYTES: u64 = 512 * 1024 * 1024;
const VTK_MAX_COLLECTION_BYTES: u64 = 2 * 1024 * 1024;
const VTK_MAX_PROVENANCE_BYTES: u64 = 4 * 1024 * 1024;
const VTK_FRAME_OVERHEAD_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone)]
struct VtkFrame {
    filename: String,
    time_s: f64,
    step_index: u64,
}

#[derive(Debug, Default)]
struct VtkSpoolState {
    frames: Vec<VtkFrame>,
    bytes: u64,
    error: Option<String>,
}

/// Disk-backed VTK XML frame sink. Scheduled solver frames are serialized as
/// they are produced, so scientific export never retains another raw run in
/// memory. A failed optional VTK write is recorded without aborting NetCDF/Zarr
/// or the authoritative simulation.
pub(crate) struct VtkSeriesSpool {
    temporary_root: PathBuf,
    frames_root: PathBuf,
    run_id: String,
    scenario: serde_json::Value,
    scenario_sha256: String,
    bathymetry_sha256: String,
    expected_frames: usize,
    quality_baseline: QualityBaseline,
    dt_s: f64,
    state: RefCell<VtkSpoolState>,
    published: Cell<bool>,
}

impl VtkSeriesSpool {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn begin(
        app_data_dir: &Path,
        run_id: &str,
        req: &super::SimulateGridRequest,
        grid: &SwGrid,
        expected_frames: usize,
        quality_baseline: QualityBaseline,
        dt_s: f64,
    ) -> Result<Self, String> {
        let cells = validate_export_shape(grid)?;
        if !(2..=VTK_MAX_FRAMES).contains(&expected_frames) || !dt_s.is_finite() || dt_s <= 0.0 {
            return Err("VTK export preflight received invalid frame or timestep metadata".into());
        }
        let raw_array_bytes = (cells as u64)
            .checked_mul(4)
            .and_then(|value| value.checked_add(8))
            .ok_or_else(|| "VTK export size estimate overflowed".to_string())?;
        let encoded_array_bytes = raw_array_bytes
            .checked_add(2)
            .map(|value| value / 3)
            .and_then(|value| value.checked_mul(4))
            .ok_or_else(|| "VTK export size estimate overflowed".to_string())?;
        let estimated_bytes = encoded_array_bytes
            .checked_mul(VTK_ARRAY_COUNT)
            .and_then(|value| value.checked_add(VTK_FRAME_OVERHEAD_BYTES))
            .and_then(|value| value.checked_mul(expected_frames as u64))
            .ok_or_else(|| "VTK export size estimate overflowed".to_string())?;
        if estimated_bytes > VTK_MAX_BYTES {
            return Err(format!(
                "VTK export rejected: {cells} cells across {expected_frames} frames would exceed the {} MiB series limit",
                VTK_MAX_BYTES / (1024 * 1024)
            ));
        }

        let scenario = serde_json::to_value(req)
            .map_err(|error| format!("failed to serialize VTK scenario provenance: {error}"))?;
        let canonical_scenario = serde_json::to_vec(req)
            .map_err(|error| format!("failed to identify VTK scenario: {error}"))?;
        let scenario_sha256 = crate::render_protocol::sha256_hex(&canonical_scenario);
        let bathymetry_sha256 = digest_f64(&grid.h_m);
        let root = export_root(app_data_dir);
        fs::create_dir_all(&root)
            .map_err(|error| format!("failed to create VTK export cache: {error}"))?;
        let mut identity = Sha256::new();
        identity.update(b"cataclysm-vtk-spool-v1\0");
        identity.update(run_id.as_bytes());
        identity.update(&canonical_scenario);
        let spool_id = format!("{:x}", identity.finalize())[..24].to_string();
        let temporary_root = root.join(format!(".{spool_id}.vtk.tmp"));
        ensure_child_path(&root, &temporary_root)?;
        if temporary_root.exists() {
            fs::remove_dir_all(&temporary_root)
                .map_err(|error| format!("failed to reset stale VTK spool: {error}"))?;
        }
        let frames_root = temporary_root.join("frames");
        fs::create_dir_all(&frames_root)
            .map_err(|error| format!("failed to create VTK frame spool: {error}"))?;

        Ok(Self {
            temporary_root,
            frames_root,
            run_id: run_id.to_string(),
            scenario,
            scenario_sha256,
            bathymetry_sha256,
            expected_frames,
            quality_baseline,
            dt_s,
            state: RefCell::new(VtkSpoolState::default()),
            published: Cell::new(false),
        })
    }

    pub(crate) fn record_frame(&self, grid: &SwGrid) {
        let mut state = self.state.borrow_mut();
        if state.error.is_some() {
            return;
        }
        if state
            .frames
            .last()
            .is_some_and(|frame| frame.step_index == grid.step_index)
        {
            return;
        }
        if state.frames.len() >= self.expected_frames || state.frames.len() >= VTK_MAX_FRAMES {
            state.error = Some(format!(
                "VTK export rejected: frame count exceeds the bounded {}-frame plan",
                self.expected_frames
            ));
            return;
        }
        let frame_index = state.frames.len();
        let filename = format!("frame-{frame_index:06}.vti");
        let destination = self.frames_root.join(&filename);
        let quality = self.quality_baseline.assess(grid, self.dt_s);
        match write_vti_frame(
            &destination,
            grid,
            &quality,
            &self.scenario_sha256,
            &self.bathymetry_sha256,
        ) {
            Ok(bytes) => {
                state.bytes = state.bytes.saturating_add(bytes);
                if state.bytes > VTK_MAX_BYTES {
                    let _ = fs::remove_file(&destination);
                    state.error = Some(format!(
                        "VTK export rejected: series exceeds the {} MiB limit",
                        VTK_MAX_BYTES / (1024 * 1024)
                    ));
                    return;
                }
                state.frames.push(VtkFrame {
                    filename,
                    time_s: grid.t_s,
                    step_index: grid.step_index,
                });
            }
            Err(error) => state.error = Some(error),
        }
    }

    /// Remove speculative frames before a GPU-to-CPU full rerun. The caller's
    /// pristine grid will then repopulate the same spool deterministically.
    #[cfg(feature = "gpu")]
    pub(crate) fn reset(&self) {
        if self.published.get() {
            return;
        }
        let result = (|| {
            if self.frames_root.exists() {
                fs::remove_dir_all(&self.frames_root)
                    .map_err(|error| format!("failed to reset VTK frame spool: {error}"))?;
            }
            fs::create_dir_all(&self.frames_root)
                .map_err(|error| format!("failed to recreate VTK frame spool: {error}"))
        })();
        let mut state = self.state.borrow_mut();
        *state = VtkSpoolState::default();
        if let Err(error) = result {
            state.error = Some(error);
        }
    }

    pub(crate) fn finalize(
        &self,
        export_id: &str,
        root: &Path,
        context: &ScientificExportContext<'_>,
    ) -> Result<ScientificVtkDescriptor, String> {
        if self.published.get() {
            return Err("VTK export spool has already been published".into());
        }
        let state = self.state.borrow();
        if let Some(error) = state.error.as_deref() {
            return Err(error.to_string());
        }
        if state.frames.len() < 2 {
            return Err("VTK export requires at least two distinct solver frames".into());
        }
        if state
            .frames
            .last()
            .is_none_or(|frame| frame.step_index != context.grid.step_index)
        {
            return Err("VTK export is missing the authoritative final solver frame".into());
        }
        if context.run_quality.failure.is_some() || !context.run_quality.finite_fields {
            return Err("VTK export rejected by the shared numerical-quality gate".into());
        }

        let collection_path = self.temporary_root.join("series.pvd");
        write_pvd(
            &collection_path,
            &state.frames,
            "frames",
            "Cataclysm VTK XML time series",
        )?;
        let collection_bytes = file_bytes(&collection_path)?;
        let provenance_path = self.temporary_root.join("cataclysm-provenance.json");
        let arrays = json!({
            "eta_m": {"units": "m", "centering": "point", "positive": "up"},
            "bathymetry_depth_m": {"units": "m", "centering": "point", "positive": "down"},
            "total_flow_depth_m": {"units": "m", "centering": "point", "positive": "down"},
            "velocity_east_m_s": {"units": "m s-1", "centering": "point"},
            "velocity_north_m_s": {"units": "m s-1", "centering": "point"},
            "speed_m_s": {"units": "m s-1", "centering": "point"}
        });
        let provenance = json!({
            "schema_version": 1,
            "format": "VTK XML ImageData time series",
            "collection_file": "series.pvd",
            "frame_directory": "frames",
            "run_id": self.run_id,
            "tool_version": env!("CARGO_PKG_VERSION"),
            "scenario_sha256": self.scenario_sha256,
            "scenario": self.scenario,
            "bathymetry_sha256": self.bathymetry_sha256,
            "bathymetry_asset_id": context.req.bathymetry_asset_id,
            "solver_backend": if context.used_gpu { "wgpu with CPU fallback" } else { "CPU rayon" },
            "horizontal_crs": {
                "authority": "EPSG",
                "code": 4326,
                "name": "WGS 84 geographic coordinates",
                "axis_order": ["longitude", "latitude"]
            },
            "vertical_datum": "mean sea level; modeled sea-surface displacement",
            "grid": {
                "nx": context.grid.nx,
                "ny": context.grid.ny,
                "origin_is_cell_center": true,
                "longitude_spacing_deg": context.grid.dlon_deg,
                "latitude_spacing_deg": context.grid.dlat_deg
            },
            "arrays": arrays,
            "frame_count": state.frames.len(),
            "timesteps_s": state.frames.iter().map(|frame| frame.time_s).collect::<Vec<_>>(),
            "quality": context.run_quality,
            "resolution_preflight": context.resolution_preflight,
            "references": [
                "LeVeque et al. (2011), doi:10.1029/2011GL049210",
                "Synolakis (1987), doi:10.1017/S002211208700175X",
                "https://github.com/SysAdminDoc/Cataclysm"
            ]
        });
        let provenance_bytes = serde_json::to_vec_pretty(&provenance)
            .map_err(|error| format!("failed to serialize VTK provenance: {error}"))?;
        fs::write(&provenance_path, &provenance_bytes)
            .map_err(|error| format!("failed to write VTK provenance: {error}"))?;

        let bytes = state
            .bytes
            .saturating_add(collection_bytes)
            .saturating_add(provenance_bytes.len() as u64);
        let files = state.frames.len() as u64 + 2;
        if bytes == 0 || bytes > VTK_MAX_BYTES {
            return Err(format!(
                "VTK export rejected: published series contains {bytes} bytes"
            ));
        }
        drop(state);

        let published = root.join(format!("{export_id}.vtk-series"));
        ensure_child_path(root, &published)?;
        if published.exists() {
            fs::remove_dir_all(&published)
                .map_err(|error| format!("failed to replace cached VTK series: {error}"))?;
        }
        fs::rename(&self.temporary_root, &published)
            .map_err(|error| format!("failed to publish VTK series: {error}"))?;
        self.published.set(true);
        Ok(ScientificVtkDescriptor {
            suggested_filename: format!("cataclysm-{}.pvd", self.run_id),
            bytes,
            files,
            frames: files.saturating_sub(2),
            format: "VTK XML ImageData time series",
            conventions: "VTK XML 1.0 + PVD Collection",
        })
    }
}

impl Drop for VtkSeriesSpool {
    fn drop(&mut self) {
        if !self.published.get() && self.temporary_root.exists() {
            let _ = fs::remove_dir_all(&self.temporary_root);
        }
    }
}

fn digest_f64(values: &[f64]) -> String {
    let mut digest = Sha256::new();
    for value in values {
        digest.update(value.to_le_bytes());
    }
    format!("{:x}", digest.finalize())
}

fn ensure_child_path(root: &Path, path: &Path) -> Result<(), String> {
    if path.parent() != Some(root) {
        return Err("VTK cache path escaped the scientific-export root".into());
    }
    Ok(())
}

fn file_bytes(path: &Path) -> Result<u64, String> {
    fs::metadata(path)
        .map_err(|error| format!("failed to inspect VTK artifact: {error}"))
        .map(|metadata| metadata.len())
}

fn digest_words(hex: &str) -> Result<[u64; 4], String> {
    if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("VTK provenance digest is not a SHA-256 value".into());
    }
    let mut words = [0u64; 4];
    for (index, word) in words.iter_mut().enumerate() {
        let start = index * 16;
        *word = u64::from_str_radix(&hex[start..start + 16], 16)
            .map_err(|_| "VTK provenance digest could not be decoded")?;
    }
    Ok(words)
}

fn quality_status_code(status: &RunQualityStatus) -> u8 {
    match status {
        RunQualityStatus::Pass => 0,
        RunQualityStatus::Warning => 1,
        RunQualityStatus::Failed => 2,
    }
}

fn write_vti_frame(
    path: &Path,
    grid: &SwGrid,
    quality: &RunQualityRecord,
    scenario_sha256: &str,
    bathymetry_sha256: &str,
) -> Result<u64, String> {
    let cells = validate_export_shape(grid)?;
    if cells > SCIENTIFIC_EXPORT_MAX_CELLS {
        return Err("VTK frame exceeds the shared scientific-export cell limit".into());
    }
    let scenario_words = digest_words(scenario_sha256)?;
    let bathymetry_words = digest_words(bathymetry_sha256)?;
    let file =
        fs::File::create(path).map_err(|error| format!("failed to create VTK frame: {error}"))?;
    let mut writer = BufWriter::new(file);
    let x_max = grid.nx.saturating_sub(1);
    let y_max = grid.ny.saturating_sub(1);
    let origin_lon = grid.west_lon + 0.5 * grid.dlon_deg;
    let origin_lat = grid.south_lat + 0.5 * grid.dlat_deg;
    writeln!(
        writer,
        "<?xml version=\"1.0\"?>\n<VTKFile type=\"ImageData\" version=\"1.0\" byte_order=\"LittleEndian\" header_type=\"UInt64\">\n  <ImageData WholeExtent=\"0 {x_max} 0 {y_max} 0 0\" Origin=\"{origin_lon:.17} {origin_lat:.17} 0\" Spacing=\"{:.17} {:.17} 1\">",
        grid.dlon_deg, grid.dlat_deg
    )
    .map_err(|error| format!("failed to write VTK frame header: {error}"))?;
    writeln!(writer, "    <FieldData>")
        .map_err(|error| format!("failed to write VTK field metadata: {error}"))?;
    for (data_type, name, components, value) in [
        ("Float64", "TimeValue", 1, format!("{:.17}", grid.t_s)),
        (
            "UInt64",
            "cataclysm_solver_step",
            1,
            grid.step_index.to_string(),
        ),
        (
            "UInt8",
            "cataclysm_quality_status_code",
            1,
            quality_status_code(&quality.status).to_string(),
        ),
        (
            "UInt8",
            "cataclysm_finite_fields",
            1,
            u8::from(quality.finite_fields).to_string(),
        ),
        (
            "Float64",
            "cataclysm_minimum_total_depth_m",
            1,
            format!("{:.17}", quality.minimum_total_depth_m),
        ),
        (
            "Float64",
            "cataclysm_cfl_number",
            1,
            format!("{:.17}", quality.cfl_number),
        ),
        (
            "Float64",
            "cataclysm_cfl_margin",
            1,
            format!("{:.17}", quality.cfl_margin),
        ),
        (
            "Float64",
            "cataclysm_mass_drift_pct",
            1,
            format!("{:.17}", quality.mass_drift_pct),
        ),
        (
            "Float64",
            "cataclysm_energy_drift_pct",
            1,
            format!("{:.17}", quality.energy_drift_pct),
        ),
        (
            "Int32",
            "cataclysm_horizontal_crs_epsg",
            1,
            "4326".to_string(),
        ),
        ("UInt8", "cataclysm_vertical_datum_msl", 1, "1".to_string()),
        (
            "UInt64",
            "cataclysm_scenario_sha256_u64",
            4,
            scenario_words
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(" "),
        ),
        (
            "UInt64",
            "cataclysm_bathymetry_sha256_u64",
            4,
            bathymetry_words
                .iter()
                .map(u64::to_string)
                .collect::<Vec<_>>()
                .join(" "),
        ),
    ] {
        writeln!(
            writer,
            "      <DataArray type=\"{data_type}\" Name=\"{name}\" NumberOfComponents=\"{components}\" NumberOfTuples=\"1\" format=\"ascii\">{value}</DataArray>"
        )
        .map_err(|error| format!("failed to write VTK field metadata: {error}"))?;
    }
    writeln!(
        writer,
        "    </FieldData>\n    <Piece Extent=\"0 {x_max} 0 {y_max} 0 0\">\n      <PointData Scalars=\"eta_m\">"
    )
    .map_err(|error| format!("failed to write VTK frame piece: {error}"))?;

    write_f32_array(&mut writer, "eta_m", "m", grid.eta_m.iter().copied(), cells)?;
    write_f32_array(
        &mut writer,
        "bathymetry_depth_m",
        "m",
        grid.h_m.iter().copied(),
        cells,
    )?;
    write_f32_array(
        &mut writer,
        "total_flow_depth_m",
        "m",
        grid.h_m
            .iter()
            .zip(&grid.eta_m)
            .map(|(depth, eta)| depth + eta),
        cells,
    )?;
    write_f32_array(
        &mut writer,
        "velocity_east_m_s",
        "m s-1",
        grid.u_ms.iter().copied(),
        cells,
    )?;
    write_f32_array(
        &mut writer,
        "velocity_north_m_s",
        "m s-1",
        grid.v_ms.iter().copied(),
        cells,
    )?;
    write_f32_array(
        &mut writer,
        "speed_m_s",
        "m s-1",
        grid.u_ms
            .iter()
            .zip(&grid.v_ms)
            .map(|(east, north)| east.hypot(*north)),
        cells,
    )?;
    writeln!(
        writer,
        "      </PointData>\n      <CellData/>\n    </Piece>\n  </ImageData>\n</VTKFile>"
    )
    .map_err(|error| format!("failed to finalize VTK frame XML: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush VTK frame: {error}"))?;
    drop(writer);
    let bytes = file_bytes(path)?;
    if bytes == 0 || bytes > VTK_MAX_BYTES {
        return Err("VTK frame size is outside the supported range".into());
    }
    Ok(bytes)
}

fn write_f32_array(
    writer: &mut impl Write,
    name: &str,
    units: &str,
    values: impl Iterator<Item = f64>,
    expected_values: usize,
) -> Result<(), String> {
    let mut block = Vec::with_capacity(
        expected_values
            .checked_mul(4)
            .and_then(|bytes| bytes.checked_add(8))
            .ok_or_else(|| "VTK array size overflowed".to_string())?,
    );
    block.extend_from_slice(&(expected_values as u64 * 4).to_le_bytes());
    let mut count = 0usize;
    for value in values {
        if !value.is_finite() {
            return Err(format!("VTK array '{name}' contains a non-finite value"));
        }
        let value = value as f32;
        if !value.is_finite() {
            return Err(format!(
                "VTK array '{name}' contains a value outside the Float32 range"
            ));
        }
        block.extend_from_slice(&value.to_le_bytes());
        count = count.saturating_add(1);
    }
    if count != expected_values {
        return Err(format!(
            "VTK array '{name}' has {count} values; expected {expected_values}"
        ));
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(block);
    writeln!(
        writer,
        "        <DataArray type=\"Float32\" Name=\"{name}\" NumberOfComponents=\"1\" format=\"binary\" Units=\"{units}\">{encoded}</DataArray>"
    )
    .map_err(|error| format!("failed to write VTK array '{name}': {error}"))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\'', "&apos;")
}

fn write_pvd(
    path: &Path,
    frames: &[VtkFrame],
    frame_directory: &str,
    _title: &str,
) -> Result<(), String> {
    let file = fs::File::create(path)
        .map_err(|error| format!("failed to create VTK collection: {error}"))?;
    let mut writer = BufWriter::new(file);
    writeln!(
        writer,
        "<?xml version=\"1.0\"?>\n<VTKFile type=\"Collection\" version=\"1.0\" byte_order=\"LittleEndian\">\n  <Collection>"
    )
    .map_err(|error| format!("failed to write VTK collection header: {error}"))?;
    let frame_directory = xml_escape(frame_directory);
    for frame in frames {
        let filename = xml_escape(&frame.filename);
        writeln!(
            writer,
            "    <DataSet timestep=\"{:.17}\" group=\"\" part=\"0\" file=\"{frame_directory}/{filename}\"/>",
            frame.time_s
        )
        .map_err(|error| format!("failed to write VTK collection entry: {error}"))?;
    }
    writeln!(writer, "  </Collection>\n</VTKFile>")
        .map_err(|error| format!("failed to finalize VTK collection: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush VTK collection: {error}"))
}

pub(super) fn copy_vtk_series(source: &Path, destination: &Path) -> Result<u64, String> {
    if destination.exists() {
        return Err("VTK collection destination already exists; choose a new filename".into());
    }
    let stem = destination
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| "VTK collection destination must have a valid filename".to_string())?;
    let parent = destination
        .parent()
        .ok_or_else(|| "VTK collection destination has no parent directory".to_string())?;
    let frame_directory_name = format!("{stem}_frames");
    let frame_destination = parent.join(&frame_directory_name);
    if frame_destination.exists() {
        return Err("VTK companion frame directory already exists; choose a new filename".into());
    }
    let temporary_collection = parent.join(format!(".{stem}.cataclysm.pvd.tmp"));
    let temporary_frames = parent.join(format!(".{stem}_frames.cataclysm.tmp"));
    if temporary_collection.exists() || temporary_frames.exists() {
        return Err("temporary VTK export destination already exists".into());
    }

    let source_frames = source.join("frames");
    if !source_frames.is_dir() {
        return Err("cached VTK frame series is unavailable; rerun the solver".into());
    }
    let cached_collection = source.join("series.pvd");
    let collection_bytes = file_bytes(&cached_collection)?;
    if collection_bytes == 0 || collection_bytes > VTK_MAX_COLLECTION_BYTES {
        return Err("cached VTK collection exceeds the supported size limit".into());
    }
    let collection_text = fs::read_to_string(&cached_collection)
        .map_err(|error| format!("failed to read cached VTK collection: {error}"))?;
    let frame_count = collection_text.matches("<DataSet ").count();
    if !(2..=VTK_MAX_FRAMES).contains(&frame_count)
        || collection_text.matches("file=\"").count() != frame_count
    {
        return Err("cached VTK collection has an invalid frame count".into());
    }
    let mut source_frame_paths = Vec::with_capacity(frame_count);
    for entry in fs::read_dir(&source_frames)
        .map_err(|error| format!("failed to read cached VTK frames: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to read cached VTK frame: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("failed to inspect cached VTK frame: {error}"))?;
        let filename = entry
            .file_name()
            .into_string()
            .map_err(|_| "cached VTK series contains a non-Unicode filename".to_string())?;
        if !file_type.is_file() || !filename.ends_with(".vti") {
            return Err("cached VTK series contains an unsupported entry".to_string());
        }
        source_frame_paths.push((filename, entry.path()));
        if source_frame_paths.len() > VTK_MAX_FRAMES {
            return Err("cached VTK series exceeds the supported frame limit".to_string());
        }
    }
    source_frame_paths.sort_by(|left, right| left.0.cmp(&right.0));
    if source_frame_paths.len() != frame_count {
        return Err("cached VTK collection does not match its companion frames".into());
    }
    for (index, (filename, path)) in source_frame_paths.iter().enumerate() {
        let expected = format!("frame-{index:06}.vti");
        if filename != &expected
            || collection_text
                .matches(&format!("file=\"frames/{expected}\""))
                .count()
                != 1
        {
            return Err("cached VTK collection contains an invalid frame reference".into());
        }
        let bytes = file_bytes(path)?;
        if bytes == 0 || bytes > VTK_MAX_BYTES {
            return Err("cached VTK frame exceeds the supported size limit".into());
        }
    }
    let provenance = source.join("cataclysm-provenance.json");
    let provenance_bytes = file_bytes(&provenance)?;
    if provenance_bytes == 0 || provenance_bytes > VTK_MAX_PROVENANCE_BYTES {
        return Err("cached VTK provenance exceeds the supported size limit".into());
    }

    fs::create_dir(&temporary_frames)
        .map_err(|error| format!("failed to create VTK companion directory: {error}"))?;
    let copy_result = (|| {
        let mut bytes = 0u64;
        for (filename, path) in &source_frame_paths {
            let copied = fs::copy(path, temporary_frames.join(filename))
                .map_err(|error| format!("failed to copy VTK frame: {error}"))?;
            bytes = bytes.saturating_add(copied);
            if bytes > VTK_MAX_BYTES {
                return Err("cached VTK series exceeds the supported size limit".to_string());
            }
        }
        let copied = fs::copy(
            &provenance,
            temporary_frames.join("cataclysm-provenance.json"),
        )
        .map_err(|error| format!("failed to copy VTK provenance: {error}"))?;
        bytes = bytes.saturating_add(copied);

        let collection_text = collection_text.replace(
            "file=\"frames/",
            &format!("file=\"{}/", xml_escape(&frame_directory_name)),
        );
        fs::write(&temporary_collection, collection_text.as_bytes())
            .map_err(|error| format!("failed to stage VTK collection: {error}"))?;
        bytes = bytes.saturating_add(file_bytes(&temporary_collection)?);
        if bytes > VTK_MAX_BYTES {
            return Err("cached VTK series exceeds the supported size limit".to_string());
        }
        Ok(bytes)
    })();
    let bytes = match copy_result {
        Ok(bytes) => bytes,
        Err(error) => {
            let _ = fs::remove_dir_all(&temporary_frames);
            let _ = fs::remove_file(&temporary_collection);
            return Err(error);
        }
    };
    fs::rename(&temporary_frames, &frame_destination).map_err(|error| {
        let _ = fs::remove_dir_all(&temporary_frames);
        let _ = fs::remove_file(&temporary_collection);
        format!("failed to publish VTK frame directory: {error}")
    })?;
    if let Err(error) = fs::rename(&temporary_collection, destination) {
        let _ = fs::remove_dir_all(&frame_destination);
        let _ = fs::remove_file(&temporary_collection);
        return Err(format!("failed to publish VTK collection: {error}"));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{ScientificExportContext, build_resolution_preflight};
    use crate::physics::solver::max_field::MaxFieldAccumulator;
    use crate::physics::solver::quality::RunQualityStatus;
    use std::process::Command;
    use tempfile::tempdir;

    fn request() -> super::super::SimulateGridRequest {
        serde_json::from_value(serde_json::json!({
            "source": { "lat_deg": 0.0, "lon_deg": 0.0 },
            "initial_amplitude_m": 1.0,
            "source_sigma_m": 1000.0,
            "mean_depth_m": 1000.0,
            "box_half_size_deg": 1.0,
            "cells_per_deg": 1.0,
            "t_end_s": 10.0,
            "n_snapshots": 2
        }))
        .unwrap()
    }

    #[test]
    fn vtk_series_writes_bounded_binary_frames_and_collection() {
        let dir = tempdir().unwrap();
        let req = request();
        let mut grid = SwGrid::new(170.0, -1.0, 173.0, 1.0, 1.0, 1.0);
        grid.fill_uniform_depth(1000.0);
        grid.eta_m = vec![0.1, -0.2, 0.3, 0.4, -0.5, 0.0];
        grid.u_ms.fill(1.25);
        grid.v_ms.fill(-0.75);
        let baseline = QualityBaseline::capture(
            &grid,
            crate::physics::solver::BoundaryMode::default_sponge(),
        );
        let spool =
            VtkSeriesSpool::begin(dir.path(), "run-1", &req, &grid, 2, baseline, 1.0).unwrap();
        spool.record_frame(&grid);
        grid.t_s = 10.0;
        grid.step_index = 10;
        spool.record_frame(&grid);
        let mut max_field = MaxFieldAccumulator::new(grid.nx * grid.ny, 0.01);
        max_field.observe(&grid);
        let quality = baseline.assess(&grid, 1.0);
        assert!(matches!(quality.status, RunQualityStatus::Pass));
        let resolution = build_resolution_preflight(&req).unwrap();
        let context = ScientificExportContext::new(
            "run-1",
            &req,
            &grid,
            &max_field,
            &quality,
            false,
            &resolution,
        );
        let root = export_root(dir.path());
        let descriptor = spool
            .finalize("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", &root, &context)
            .unwrap();
        assert_eq!(descriptor.frames, 2);
        assert!(descriptor.bytes > 0);
        let published = root.join("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vtk-series");
        let pvd = fs::read_to_string(published.join("series.pvd")).unwrap();
        assert_eq!(pvd.matches("<DataSet ").count(), 2);
        assert!(pvd.contains("timestep=\"10.00000000000000000\""));
        let frame = fs::read_to_string(published.join("frames/frame-000001.vti")).unwrap();
        for array in [
            "eta_m",
            "bathymetry_depth_m",
            "total_flow_depth_m",
            "velocity_east_m_s",
            "velocity_north_m_s",
            "speed_m_s",
        ] {
            assert!(frame.contains(&format!("Name=\"{array}\"")));
        }
        assert!(frame.contains("Name=\"TimeValue\""));
        assert!(frame.contains("Name=\"cataclysm_scenario_sha256_u64\""));
        let provenance: serde_json::Value =
            serde_json::from_slice(&fs::read(published.join("cataclysm-provenance.json")).unwrap())
                .unwrap();
        assert_eq!(provenance["horizontal_crs"]["code"], 4326);
        assert_eq!(provenance["frame_count"], 2);

        if let Ok(python) = std::env::var("CATACLYSM_VTK_PYTHON") {
            let script = r#"
import math
import sys
from vtkmodules.vtkIOXML import vtkXMLImageDataReader

reader = vtkXMLImageDataReader()
reader.SetFileName(sys.argv[1])
reader.Update()
image = reader.GetOutput()
assert image.GetDimensions() == (3, 2, 1), image.GetDimensions()
point_data = image.GetPointData()
expected = [
    "eta_m",
    "bathymetry_depth_m",
    "total_flow_depth_m",
    "velocity_east_m_s",
    "velocity_north_m_s",
    "speed_m_s",
]
assert [point_data.GetArrayName(i) for i in range(point_data.GetNumberOfArrays())] == expected
assert math.isclose(point_data.GetArray("eta_m").GetTuple1(4), -0.5, abs_tol=1e-6)
assert math.isclose(point_data.GetArray("speed_m_s").GetTuple1(0), math.hypot(1.25, -0.75), rel_tol=1e-6)
assert math.isclose(image.GetFieldData().GetArray("TimeValue").GetTuple1(0), 10.0)

try:
    import paraview.simple as pv
except ImportError:
    pass
else:
    series = pv.OpenDataFile(sys.argv[2])
    assert series is not None
    series.UpdatePipelineInformation()
    assert [float(value) for value in series.TimestepValues] == [0.0, 10.0]
    assert list(series.PointData.keys()) == expected
    pv.UpdatePipeline(time=10.0, proxy=series)
    assert series.GetDataInformation().GetNumberOfPoints() == 6
    pv.Delete(series)
"#;
            let status = Command::new(python)
                .arg("-c")
                .arg(script)
                .arg(published.join("frames/frame-000001.vti"))
                .arg(published.join("series.pvd"))
                .status()
                .expect("Python VTK acceptance command should start");
            assert!(status.success(), "Python VTK ImageData acceptance failed");
        }
    }

    #[test]
    fn vtk_copy_rewrites_collection_and_refuses_existing_destinations() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("cached.vtk-series");
        let source_frames = source.join("frames");
        fs::create_dir_all(&source_frames).unwrap();
        fs::write(source_frames.join("frame-000000.vti"), b"frame zero").unwrap();
        fs::write(source_frames.join("frame-000001.vti"), b"frame one").unwrap();
        fs::write(
            source.join("series.pvd"),
            b"<VTKFile><Collection><DataSet file=\"frames/frame-000000.vti\"/><DataSet file=\"frames/frame-000001.vti\"/></Collection></VTKFile>",
        )
        .unwrap();
        fs::write(source.join("cataclysm-provenance.json"), b"{}").unwrap();

        let destination = dir.path().join("saved.pvd");
        let bytes = copy_vtk_series(&source, &destination).unwrap();
        assert!(bytes > 0);
        let collection = fs::read_to_string(&destination).unwrap();
        assert_eq!(collection.matches("<DataSet ").count(), 2);
        assert!(collection.contains("file=\"saved_frames/frame-000000.vti\""));
        assert_eq!(
            fs::read(dir.path().join("saved_frames/frame-000001.vti")).unwrap(),
            b"frame one"
        );
        assert_eq!(
            fs::read(dir.path().join("saved_frames/cataclysm-provenance.json")).unwrap(),
            b"{}"
        );
        assert!(copy_vtk_series(&source, &destination).is_err());
        fs::write(source_frames.join("unexpected.vti"), b"unexpected").unwrap();
        assert!(copy_vtk_series(&source, &dir.path().join("corrupt.pvd")).is_err());
    }
}
