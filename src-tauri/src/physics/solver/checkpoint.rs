//! Versioned, authenticated solver checkpoints with atomic bounded storage.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::max_field::MaxFieldAccumulator;
use super::{Colormap, SwGrid};

const MAGIC: &[u8; 8] = b"CATCKPT1";
pub const SCHEMA_VERSION: u16 = 1;
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_CELLS: usize = 4_000_000;
const FIELD_COUNT: usize = 8;
const MAX_CHECKPOINTS: usize = 4;
const EXTENSION: &str = "catcheckpoint";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CheckpointIdentity {
    pub run_id: String,
    pub scenario_sha256: String,
    pub settings_sha256: String,
    pub data_sha256: String,
    pub solver_version: String,
    pub created_at_ms: u64,
    pub dt_s: f64,
    pub t_end_s: f64,
    pub n_snapshots: u32,
    pub next_snapshot_interval: u32,
}

#[derive(Debug, Clone)]
pub struct SolverCheckpoint {
    pub identity: CheckpointIdentity,
    pub grid: SwGrid,
    pub max_field: MaxFieldAccumulator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Header {
    schema_version: u16,
    identity: CheckpointIdentity,
    nx: u32,
    ny: u32,
    dlon_deg: f64,
    dlat_deg: f64,
    west_lon: f64,
    south_lat: f64,
    time_s: f64,
    step_index: u64,
    colormap: Colormap,
    max_field_last_t_s: f64,
    arrival_threshold_m: f64,
    max_field_observed: bool,
    payload_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckpointSummary {
    pub run_id: String,
    pub scenario_sha256: String,
    pub solver_version: String,
    pub created_at_ms: u64,
    pub time_s: f64,
    pub t_end_s: f64,
    pub step_index: u64,
    #[serde(skip)]
    pub path: PathBuf,
}

pub fn encode(checkpoint: &SolverCheckpoint) -> Result<Vec<u8>, String> {
    validate_checkpoint(checkpoint)?;
    encode_state(
        &checkpoint.identity,
        &checkpoint.grid,
        &checkpoint.max_field,
    )
}

pub fn encode_state(
    identity: &CheckpointIdentity,
    grid: &SwGrid,
    max_field: &MaxFieldAccumulator,
) -> Result<Vec<u8>, String> {
    validate_state(identity, grid, max_field)?;
    let payload = encode_payload(grid, max_field);
    let (max_field_last_t_s, arrival_threshold_m, max_field_observed) =
        max_field.checkpoint_metadata();
    let header = Header {
        schema_version: SCHEMA_VERSION,
        identity: identity.clone(),
        nx: u32::try_from(grid.nx).map_err(|_| "checkpoint nx exceeds u32")?,
        ny: u32::try_from(grid.ny).map_err(|_| "checkpoint ny exceeds u32")?,
        dlon_deg: grid.dlon_deg,
        dlat_deg: grid.dlat_deg,
        west_lon: grid.west_lon,
        south_lat: grid.south_lat,
        time_s: grid.t_s,
        step_index: grid.step_index,
        colormap: grid.colormap,
        max_field_last_t_s,
        arrival_threshold_m,
        max_field_observed,
        payload_sha256: crate::render_protocol::sha256_hex(&payload),
    };
    let header_bytes = serde_json::to_vec(&header)
        .map_err(|error| format!("checkpoint header could not be encoded: {error}"))?;
    if header_bytes.len() > MAX_HEADER_BYTES {
        return Err("checkpoint header exceeds its size budget".to_string());
    }
    let header_len =
        u32::try_from(header_bytes.len()).map_err(|_| "checkpoint header is too large")?;
    let payload_len =
        u64::try_from(payload.len()).map_err(|_| "checkpoint payload is too large")?;
    let mut encoded = Vec::with_capacity(8 + 2 + 4 + 8 + header_bytes.len() + payload.len());
    encoded.extend_from_slice(MAGIC);
    encoded.extend_from_slice(&SCHEMA_VERSION.to_le_bytes());
    encoded.extend_from_slice(&header_len.to_le_bytes());
    encoded.extend_from_slice(&payload_len.to_le_bytes());
    encoded.extend_from_slice(&header_bytes);
    encoded.extend_from_slice(&payload);
    Ok(encoded)
}

pub fn decode(bytes: &[u8]) -> Result<SolverCheckpoint, String> {
    const PREFIX: usize = 8 + 2 + 4 + 8;
    if bytes.len() < PREFIX || &bytes[..8] != MAGIC {
        return Err("checkpoint magic is invalid".to_string());
    }
    let schema_version = u16::from_le_bytes(bytes[8..10].try_into().unwrap());
    if schema_version != SCHEMA_VERSION {
        return Err(format!(
            "checkpoint schema {schema_version} is incompatible with schema {SCHEMA_VERSION}"
        ));
    }
    let header_len = u32::from_le_bytes(bytes[10..14].try_into().unwrap()) as usize;
    let payload_len = usize::try_from(u64::from_le_bytes(bytes[14..22].try_into().unwrap()))
        .map_err(|_| "checkpoint payload length exceeds this platform")?;
    if header_len == 0 || header_len > MAX_HEADER_BYTES {
        return Err("checkpoint header length is invalid".to_string());
    }
    let expected_len = PREFIX
        .checked_add(header_len)
        .and_then(|length| length.checked_add(payload_len))
        .ok_or_else(|| "checkpoint length overflow".to_string())?;
    if bytes.len() != expected_len {
        return Err("checkpoint length does not match its envelope".to_string());
    }
    let header: Header = serde_json::from_slice(&bytes[PREFIX..PREFIX + header_len])
        .map_err(|error| format!("checkpoint header is invalid: {error}"))?;
    if header.schema_version != schema_version {
        return Err("checkpoint envelope/header schema mismatch".to_string());
    }
    let payload = &bytes[PREFIX + header_len..];
    if crate::render_protocol::sha256_hex(payload) != header.payload_sha256 {
        return Err("checkpoint payload integrity check failed".to_string());
    }
    decode_payload(header, payload)
}

pub fn write_latest(root: &Path, checkpoint: &SolverCheckpoint) -> Result<PathBuf, String> {
    write_latest_state(
        root,
        &checkpoint.identity,
        &checkpoint.grid,
        &checkpoint.max_field,
    )
}

pub fn write_latest_state(
    root: &Path,
    identity: &CheckpointIdentity,
    grid: &SwGrid,
    max_field: &MaxFieldAccumulator,
) -> Result<PathBuf, String> {
    let encoded = encode_state(identity, grid, max_field)?;
    let directory = checkpoint_directory(root);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("checkpoint directory could not be created: {error}"))?;
    let final_path = checkpoint_path(root, &identity.run_id)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let temporary = directory.join(format!(
        ".{}.tmp-{}-{nonce}",
        identity.run_id,
        std::process::id()
    ));
    let previous = directory.join(format!(".{}.previous", identity.run_id));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("checkpoint temporary file could not be created: {error}"))?;
        file.write_all(&encoded)
            .map_err(|error| format!("checkpoint temporary file could not be written: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("checkpoint temporary file could not be synced: {error}"))?;
        if final_path.exists() {
            let _ = fs::remove_file(&previous);
            fs::rename(&final_path, &previous)
                .map_err(|error| format!("previous checkpoint could not be staged: {error}"))?;
        }
        if let Err(error) = fs::rename(&temporary, &final_path) {
            if previous.exists() {
                let _ = fs::rename(&previous, &final_path);
            }
            return Err(format!(
                "checkpoint could not be committed atomically: {error}"
            ));
        }
        let _ = fs::remove_file(&previous);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    prune(root, Some(&final_path))?;
    Ok(final_path)
}

pub fn load_latest(root: &Path, run_id: &str) -> Result<SolverCheckpoint, String> {
    let path = checkpoint_path(root, run_id)?;
    let bytes = read_bounded(&path)?;
    match decode(&bytes) {
        Ok(checkpoint) => Ok(checkpoint),
        Err(error) => {
            quarantine(&path);
            Err(format!("{error}; checkpoint was quarantined"))
        }
    }
}

pub fn list(root: &Path) -> Result<Vec<CheckpointSummary>, String> {
    let directory = checkpoint_directory(root);
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("checkpoint directory could not be read: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("checkpoint entry could not be read: {error}"))?
            .path();
        if path.extension().and_then(|value| value.to_str()) != Some(EXTENSION) {
            continue;
        }
        if let Ok(checkpoint) = read_bounded(&path).and_then(|bytes| decode(&bytes)) {
            summaries.push(CheckpointSummary {
                run_id: checkpoint.identity.run_id,
                scenario_sha256: checkpoint.identity.scenario_sha256,
                solver_version: checkpoint.identity.solver_version,
                created_at_ms: checkpoint.identity.created_at_ms,
                time_s: checkpoint.grid.t_s,
                t_end_s: checkpoint.identity.t_end_s,
                step_index: checkpoint.grid.step_index,
                path,
            });
        } else {
            quarantine(&path);
        }
    }
    summaries.sort_by_key(|summary| std::cmp::Reverse(summary.created_at_ms));
    Ok(summaries)
}

pub fn remove(root: &Path, run_id: &str) -> Result<bool, String> {
    let path = checkpoint_path(root, run_id)?;
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path).map_err(|error| format!("checkpoint could not be removed: {error}"))?;
    Ok(true)
}

fn encode_payload(grid: &SwGrid, max_field: &MaxFieldAccumulator) -> Vec<u8> {
    let fields = [
        grid.h_m.as_slice(),
        grid.eta_m.as_slice(),
        grid.u_ms.as_slice(),
        grid.v_ms.as_slice(),
        max_field.checkpoint_fields()[0],
        max_field.checkpoint_fields()[1],
        max_field.checkpoint_fields()[2],
        max_field.checkpoint_fields()[3],
    ];
    let mut payload = Vec::with_capacity(grid.nx * grid.ny * FIELD_COUNT * 8);
    for field in fields {
        for value in field {
            payload.extend_from_slice(&value.to_le_bytes());
        }
    }
    payload
}

fn decode_payload(header: Header, payload: &[u8]) -> Result<SolverCheckpoint, String> {
    let nx = header.nx as usize;
    let ny = header.ny as usize;
    let cells = nx
        .checked_mul(ny)
        .filter(|cells| (4..=MAX_CELLS).contains(cells))
        .ok_or_else(|| "checkpoint grid dimensions are invalid".to_string())?;
    let expected_payload = cells
        .checked_mul(FIELD_COUNT * 8)
        .ok_or_else(|| "checkpoint payload size overflow".to_string())?;
    if payload.len() != expected_payload {
        return Err("checkpoint field payload length is invalid".to_string());
    }
    let mut fields = Vec::with_capacity(FIELD_COUNT);
    for field_index in 0..FIELD_COUNT {
        let start = field_index * cells * 8;
        let mut field = Vec::with_capacity(cells);
        for chunk in payload[start..start + cells * 8].chunks_exact(8) {
            field.push(f64::from_le_bytes(chunk.try_into().unwrap()));
        }
        fields.push(field);
    }
    let field_slices = fields.iter().map(Vec::as_slice).collect::<Vec<_>>();
    validate_fields(&field_slices)?;
    let [
        h_m,
        eta_m,
        u_ms,
        v_ms,
        peak_m,
        t_of_max_s,
        arrival_s,
        energy_m2s,
    ]: [Vec<f64>; 8] = fields
        .try_into()
        .map_err(|_| "checkpoint fields are incomplete".to_string())?;
    let grid = SwGrid {
        nx,
        ny,
        dlon_deg: header.dlon_deg,
        dlat_deg: header.dlat_deg,
        west_lon: header.west_lon,
        south_lat: header.south_lat,
        h_m,
        eta_m,
        u_ms,
        v_ms,
        t_s: header.time_s,
        step_index: header.step_index,
        colormap: header.colormap,
    };
    let max_fields = [peak_m, t_of_max_s, arrival_s, energy_m2s];
    let max_field = MaxFieldAccumulator::restore_checkpoint(
        max_fields,
        header.max_field_last_t_s,
        header.arrival_threshold_m,
        header.max_field_observed,
    );
    let checkpoint = SolverCheckpoint {
        identity: header.identity,
        grid,
        max_field,
    };
    validate_checkpoint(&checkpoint)?;
    Ok(checkpoint)
}

fn validate_checkpoint(checkpoint: &SolverCheckpoint) -> Result<(), String> {
    validate_state(
        &checkpoint.identity,
        &checkpoint.grid,
        &checkpoint.max_field,
    )
}

fn validate_state(
    identity: &CheckpointIdentity,
    grid: &SwGrid,
    max_field: &MaxFieldAccumulator,
) -> Result<(), String> {
    validate_run_id(&identity.run_id)?;
    for (label, digest) in [
        ("scenario", &identity.scenario_sha256),
        ("settings", &identity.settings_sha256),
        ("data", &identity.data_sha256),
    ] {
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("checkpoint {label} digest is invalid"));
        }
    }
    let cells = grid
        .nx
        .checked_mul(grid.ny)
        .filter(|cells| (4..=MAX_CELLS).contains(cells))
        .ok_or_else(|| "checkpoint grid dimensions are invalid".to_string())?;
    let fields = [
        grid.h_m.as_slice(),
        grid.eta_m.as_slice(),
        grid.u_ms.as_slice(),
        grid.v_ms.as_slice(),
        max_field.checkpoint_fields()[0],
        max_field.checkpoint_fields()[1],
        max_field.checkpoint_fields()[2],
        max_field.checkpoint_fields()[3],
    ];
    if fields.iter().any(|field| field.len() != cells) {
        return Err("checkpoint fields do not match grid dimensions".to_string());
    }
    validate_fields(&fields)?;
    for (label, value) in [
        ("dt_s", identity.dt_s),
        ("t_end_s", identity.t_end_s),
        ("time_s", grid.t_s),
        ("dlon_deg", grid.dlon_deg),
        ("dlat_deg", grid.dlat_deg),
        ("west_lon", grid.west_lon),
        ("south_lat", grid.south_lat),
        ("max_field_last_t_s", max_field.checkpoint_metadata().0),
        ("arrival_threshold_m", max_field.checkpoint_metadata().1),
    ] {
        if !value.is_finite() {
            return Err(format!("checkpoint {label} must be finite"));
        }
    }
    if identity.dt_s <= 0.0
        || identity.t_end_s < grid.t_s
        || max_field.checkpoint_metadata().1 <= 0.0
        || identity.next_snapshot_interval > identity.n_snapshots
    {
        return Err("checkpoint progress metadata is inconsistent".to_string());
    }
    Ok(())
}

fn validate_fields(fields: &[&[f64]]) -> Result<(), String> {
    if fields.len() != FIELD_COUNT {
        return Err("checkpoint field count is invalid".to_string());
    }
    for (index, field) in fields.iter().enumerate() {
        for &value in *field {
            let valid = if index == 6 {
                value.is_finite() || value == f64::INFINITY
            } else {
                value.is_finite()
            };
            if !valid || (index == 0 && value < 0.0) {
                return Err(format!(
                    "checkpoint field {index} contains an invalid value"
                ));
            }
        }
    }
    Ok(())
}

fn validate_run_id(run_id: &str) -> Result<(), String> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("checkpoint run_id has an invalid format".to_string());
    }
    Ok(())
}

fn checkpoint_directory(root: &Path) -> PathBuf {
    root.join("solver-checkpoints")
}

fn checkpoint_path(root: &Path, run_id: &str) -> Result<PathBuf, String> {
    validate_run_id(run_id)?;
    Ok(checkpoint_directory(root).join(format!("{run_id}.{EXTENSION}")))
}

fn maximum_file_bytes() -> u64 {
    (MAX_CELLS * FIELD_COUNT * 8 + MAX_HEADER_BYTES + 22) as u64
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let mut file =
        File::open(path).map_err(|error| format!("checkpoint could not be opened: {error}"))?;
    let length = file
        .metadata()
        .map_err(|error| format!("checkpoint metadata could not be read: {error}"))?
        .len();
    if length == 0 || length > maximum_file_bytes() {
        return Err("checkpoint file exceeds its size budget".to_string());
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("checkpoint could not be read: {error}"))?;
    Ok(bytes)
}

fn quarantine(path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or(EXTENSION);
    let quarantine_path = path.with_extension(format!("{extension}.quarantine-{timestamp}"));
    let _ = fs::rename(path, quarantine_path);
}

fn prune(root: &Path, protected: Option<&Path>) -> Result<(), String> {
    let mut entries = list(root)?;
    let keep = MAX_CHECKPOINTS.min(entries.len());
    for summary in entries.drain(keep..) {
        if protected != Some(summary.path.as_path()) {
            let _ = fs::remove_file(summary.path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture(run_id: &str, created_at_ms: u64) -> SolverCheckpoint {
        let mut grid = SwGrid::new(-1.0, -1.0, 1.0, 1.0, 1.0, 1.0);
        grid.fill_uniform_depth(4_000.0);
        grid.eta_m = vec![0.25, -0.5, 0.75, -1.0];
        grid.u_ms = vec![1.0, 2.0, 3.0, 4.0];
        grid.v_ms = vec![-1.0, -2.0, -3.0, -4.0];
        grid.t_s = 12.5;
        grid.step_index = 5;
        let mut max_field = MaxFieldAccumulator::new(4, 0.01);
        max_field.observe(&grid);
        SolverCheckpoint {
            identity: CheckpointIdentity {
                run_id: run_id.to_string(),
                scenario_sha256: "a".repeat(64),
                settings_sha256: "b".repeat(64),
                data_sha256: "c".repeat(64),
                solver_version: "swe-cpu-1.0.0".to_string(),
                created_at_ms,
                dt_s: 2.5,
                t_end_s: 100.0,
                n_snapshots: 5,
                next_snapshot_interval: 2,
            },
            grid,
            max_field,
        }
    }

    #[test]
    fn roundtrip_preserves_all_authoritative_fields() {
        let original = fixture("run-roundtrip", 1);
        let restored = decode(&encode(&original).unwrap()).unwrap();
        assert_eq!(restored.identity, original.identity);
        assert_eq!(restored.grid.h_m, original.grid.h_m);
        assert_eq!(restored.grid.eta_m, original.grid.eta_m);
        assert_eq!(restored.grid.u_ms, original.grid.u_ms);
        assert_eq!(restored.grid.v_ms, original.grid.v_ms);
        assert_eq!(
            restored.max_field.checkpoint_fields(),
            original.max_field.checkpoint_fields()
        );
    }

    #[test]
    fn corruption_fails_integrity_and_is_quarantined() {
        let root = tempdir().unwrap();
        let path = write_latest(root.path(), &fixture("run-corrupt", 1)).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        *bytes.last_mut().unwrap() ^= 0xff;
        fs::write(&path, bytes).unwrap();
        let error = load_latest(root.path(), "run-corrupt").unwrap_err();
        assert!(error.contains("integrity"));
        assert!(!path.exists());
        assert!(
            fs::read_dir(checkpoint_directory(root.path()))
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .path()
                    .to_string_lossy()
                    .contains("quarantine"))
        );
    }

    #[test]
    fn storage_is_bounded_to_four_recent_runs() {
        let root = tempdir().unwrap();
        for index in 0..6 {
            write_latest(root.path(), &fixture(&format!("run-{index}"), index)).unwrap();
        }
        let summaries = list(root.path()).unwrap();
        assert_eq!(summaries.len(), MAX_CHECKPOINTS);
        assert_eq!(summaries[0].run_id, "run-5");
        assert_eq!(summaries[3].run_id, "run-2");
    }

    #[test]
    fn incompatible_schema_is_quarantined() {
        let root = tempdir().unwrap();
        let path = write_latest(root.path(), &fixture("run-future", 1)).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        bytes[8..10].copy_from_slice(&(SCHEMA_VERSION + 1).to_le_bytes());
        fs::write(&path, bytes).unwrap();
        let error = load_latest(root.path(), "run-future").unwrap_err();
        assert!(error.contains("incompatible"));
        assert!(!path.exists());
    }
}
