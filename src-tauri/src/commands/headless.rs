use super::*;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const CLI_SCHEMA_VERSION: u32 = 1;
const MAX_REQUEST_BYTES: u64 = 4 * 1024 * 1024;
const MAX_RESULT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_PACKAGE_ENTRY_BYTES: usize = 16 * 1024 * 1024;
const MAX_PACKAGE_ENTRIES: usize = 24;

#[derive(Debug, Deserialize, Serialize)]
struct CliScenarioFile {
    schema_version: u32,
    request: SimulateGridRequest,
}

#[derive(Debug)]
struct CliFailure {
    exit_code: i32,
    message: String,
}

impl CliFailure {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            exit_code: 2,
            message: message.into(),
        }
    }

    fn io(message: impl Into<String>) -> Self {
        Self {
            exit_code: 3,
            message: message.into(),
        }
    }

    fn run(message: impl Into<String>) -> Self {
        Self {
            exit_code: 4,
            message: message.into(),
        }
    }
}

#[derive(Debug)]
struct ParsedArgs {
    command: String,
    options: HashMap<String, String>,
}

fn help_text() -> &'static str {
    "Cataclysm headless CLI\n\n\
Usage: cataclysm-cli <command> [options]\n\n\
Commands:\n\
  validate  --input scenario.json | --package scenario.cataclysm [--output result.json]\n\
  run       --input scenario.json [--output result.json] [--data-dir DIR] [--run-id ID] [--cancel-file FILE]\n\
  resume    --input scenario.json --resume-run-id ID [--output result.json] [--data-dir DIR] [--run-id ID]\n\
  compare   --left run.json --right run.json [--output result.json]\n\
  inspect   --result run.json --lat DEG --lon DEG [--data-dir DIR] [--output result.json]\n\
  export    --result run.json --kind netcdf|zarr --destination PATH [--data-dir DIR] [--output result.json]\n\
  benchmark --input scenario.json [--iterations N] [--data-dir DIR] [--output result.json]\n\n\
Scenario files use {\"schema_version\":1,\"request\":{...}}. Final JSON is written\n\
to stdout unless --output is supplied; progress and errors are NDJSON on stderr.\n"
}

fn parse_args(args: impl IntoIterator<Item = OsString>) -> Result<Option<ParsedArgs>, CliFailure> {
    let mut values = args
        .into_iter()
        .map(|value| {
            value
                .into_string()
                .map_err(|_| CliFailure::usage("arguments must be valid UTF-8"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if values.is_empty() || matches!(values[0].as_str(), "-h" | "--help" | "help") {
        return Ok(None);
    }
    let command = values.remove(0);
    let mut options = HashMap::new();
    let mut index = 0;
    while index < values.len() {
        let key = &values[index];
        if !key.starts_with("--") || key.len() <= 2 {
            return Err(CliFailure::usage(format!(
                "unexpected positional argument '{key}'"
            )));
        }
        let value = values
            .get(index + 1)
            .ok_or_else(|| CliFailure::usage(format!("option '{key}' requires a value")))?;
        if value.starts_with("--") {
            return Err(CliFailure::usage(format!(
                "option '{key}' requires a value"
            )));
        }
        let name = key.trim_start_matches("--").to_string();
        if options.insert(name.clone(), value.clone()).is_some() {
            return Err(CliFailure::usage(format!(
                "option '--{name}' was provided more than once"
            )));
        }
        index += 2;
    }
    Ok(Some(ParsedArgs { command, options }))
}

fn option<'a>(args: &'a ParsedArgs, name: &str) -> Result<&'a str, CliFailure> {
    args.options
        .get(name)
        .map(String::as_str)
        .ok_or_else(|| CliFailure::usage(format!("{} requires --{name}", args.command)))
}

fn reject_unknown(args: &ParsedArgs, allowed: &[&str]) -> Result<(), CliFailure> {
    if let Some(name) = args
        .options
        .keys()
        .find(|name| !allowed.contains(&name.as_str()))
    {
        return Err(CliFailure::usage(format!(
            "unknown option '--{name}' for {}",
            args.command
        )));
    }
    Ok(())
}

fn read_bounded(path: &Path, maximum: u64, label: &str) -> Result<Vec<u8>, CliFailure> {
    let metadata = fs::metadata(path).map_err(|error| {
        CliFailure::io(format!(
            "failed to inspect {label} '{}': {error}",
            path.display()
        ))
    })?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err(CliFailure::io(format!(
            "{label} is empty, not a file, or exceeds {maximum} bytes"
        )));
    }
    fs::read(path).map_err(|error| {
        CliFailure::io(format!(
            "failed to read {label} '{}': {error}",
            path.display()
        ))
    })
}

fn read_scenario(path: &Path) -> Result<CliScenarioFile, CliFailure> {
    let bytes = read_bounded(path, MAX_REQUEST_BYTES, "scenario")?;
    let scenario: CliScenarioFile = serde_json::from_slice(&bytes)
        .map_err(|error| CliFailure::usage(format!("scenario JSON is invalid: {error}")))?;
    if scenario.schema_version != CLI_SCHEMA_VERSION {
        return Err(CliFailure::usage(format!(
            "scenario schema {} is unsupported; expected {CLI_SCHEMA_VERSION}",
            scenario.schema_version
        )));
    }
    validate_simulate_grid(&scenario.request).map_err(CliFailure::usage)?;
    Ok(scenario)
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, CliFailure> {
    bytes
        .get(offset..offset.saturating_add(2))
        .and_then(|slice| slice.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or_else(|| CliFailure::usage("portable package contains a truncated ZIP integer"))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, CliFailure> {
    bytes
        .get(offset..offset.saturating_add(4))
        .and_then(|slice| slice.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| CliFailure::usage("portable package contains a truncated ZIP integer"))
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut value = 0xffff_ffff_u32;
    for byte in bytes {
        value ^= u32::from(*byte);
        for _ in 0..8 {
            value = if value & 1 == 0 {
                value >> 1
            } else {
                0xedb8_8320 ^ (value >> 1)
            };
        }
    }
    value ^ 0xffff_ffff
}

fn validate_package_path(path: &str) -> Result<(), CliFailure> {
    if path.is_empty()
        || path.len() > 180
        || path.starts_with('/')
        || path.contains('\\')
        || path.bytes().any(|byte| byte <= 0x1f || byte == 0x7f)
        || path
            .split('/')
            .any(|part| part.is_empty() || matches!(part, "." | ".."))
        || (path.len() >= 2 && path.as_bytes()[1] == b':')
    {
        return Err(CliFailure::usage(
            "portable package contains an unsafe entry path",
        ));
    }
    let extension = path
        .rsplit_once('.')
        .map(|(_, value)| value.to_ascii_lowercase());
    const EXECUTABLE_EXTENSIONS: &[&str] = &[
        "app", "apk", "bat", "bin", "cjs", "cmd", "com", "dll", "dylib", "exe", "hta", "htm",
        "html", "jar", "js", "lnk", "mjs", "msi", "ps1", "scr", "sh", "so", "svg", "vbs", "wasm",
        "wsf",
    ];
    if extension
        .as_deref()
        .is_some_and(|value| EXECUTABLE_EXTENSIONS.contains(&value))
    {
        return Err(CliFailure::usage(
            "portable package contains executable content",
        ));
    }
    Ok(())
}

fn parse_stored_zip(bytes: &[u8]) -> Result<HashMap<String, Vec<u8>>, CliFailure> {
    const EOCD_SIGNATURE: [u8; 4] = 0x0605_4b50_u32.to_le_bytes();
    const CENTRAL_SIGNATURE: u32 = 0x0201_4b50;
    const LOCAL_SIGNATURE: u32 = 0x0403_4b50;
    if bytes.len() < 22 {
        return Err(CliFailure::usage("portable package ZIP is truncated"));
    }
    let search_start = bytes.len().saturating_sub(65_557);
    let eocd = (search_start..=bytes.len() - 4)
        .rev()
        .find(|offset| bytes[*offset..*offset + 4] == EOCD_SIGNATURE)
        .ok_or_else(|| CliFailure::usage("portable package ZIP end record is missing"))?;
    let disk = read_u16(bytes, eocd + 4)?;
    let central_disk = read_u16(bytes, eocd + 6)?;
    let entries_on_disk = read_u16(bytes, eocd + 8)? as usize;
    let entry_count = read_u16(bytes, eocd + 10)? as usize;
    let central_bytes = read_u32(bytes, eocd + 12)? as usize;
    let central_offset = read_u32(bytes, eocd + 16)? as usize;
    let comment_bytes = read_u16(bytes, eocd + 20)? as usize;
    if disk != 0
        || central_disk != 0
        || entry_count == 0
        || entries_on_disk != entry_count
        || entry_count > MAX_PACKAGE_ENTRIES
        || eocd.saturating_add(22).saturating_add(comment_bytes) != bytes.len()
        || central_offset.saturating_add(central_bytes) != eocd
    {
        return Err(CliFailure::usage(
            "portable package ZIP directory is invalid or unsupported",
        ));
    }

    let mut entries = HashMap::with_capacity(entry_count);
    let mut occupied = Vec::with_capacity(entry_count);
    let mut cursor = central_offset;
    for _ in 0..entry_count {
        if read_u32(bytes, cursor)? != CENTRAL_SIGNATURE {
            return Err(CliFailure::usage(
                "portable package ZIP central entry is invalid",
            ));
        }
        let flags = read_u16(bytes, cursor + 8)?;
        let method = read_u16(bytes, cursor + 10)?;
        let expected_crc = read_u32(bytes, cursor + 16)?;
        let compressed = read_u32(bytes, cursor + 20)? as usize;
        let expanded = read_u32(bytes, cursor + 24)? as usize;
        let name_bytes = read_u16(bytes, cursor + 28)? as usize;
        let extra_bytes = read_u16(bytes, cursor + 30)? as usize;
        let entry_comment_bytes = read_u16(bytes, cursor + 32)? as usize;
        let local_offset = read_u32(bytes, cursor + 42)? as usize;
        let entry_end = cursor
            .checked_add(46)
            .and_then(|value| value.checked_add(name_bytes))
            .and_then(|value| value.checked_add(extra_bytes))
            .and_then(|value| value.checked_add(entry_comment_bytes))
            .ok_or_else(|| CliFailure::usage("portable package ZIP entry size overflow"))?;
        let name = std::str::from_utf8(
            bytes
                .get(cursor + 46..cursor + 46 + name_bytes)
                .ok_or_else(|| CliFailure::usage("portable package ZIP entry name is truncated"))?,
        )
        .map_err(|_| CliFailure::usage("portable package ZIP entry name is not UTF-8"))?;
        validate_package_path(name)?;
        if flags & !0x0800 != 0 || method != 0 || compressed != expanded {
            return Err(CliFailure::usage(
                "portable packages require unencrypted, store-only ZIP entries",
            ));
        }
        if expanded == 0 || expanded > MAX_PACKAGE_ENTRY_BYTES {
            return Err(CliFailure::usage(
                "portable package entry exceeds its size budget",
            ));
        }
        if read_u32(bytes, local_offset)? != LOCAL_SIGNATURE {
            return Err(CliFailure::usage(
                "portable package ZIP local entry is invalid",
            ));
        }
        let local_flags = read_u16(bytes, local_offset + 6)?;
        let local_method = read_u16(bytes, local_offset + 8)?;
        let local_crc = read_u32(bytes, local_offset + 14)?;
        let local_compressed = read_u32(bytes, local_offset + 18)? as usize;
        let local_expanded = read_u32(bytes, local_offset + 22)? as usize;
        let local_name_bytes = read_u16(bytes, local_offset + 26)? as usize;
        let local_extra_bytes = read_u16(bytes, local_offset + 28)? as usize;
        let data_start = local_offset
            .checked_add(30)
            .and_then(|value| value.checked_add(local_name_bytes))
            .and_then(|value| value.checked_add(local_extra_bytes))
            .ok_or_else(|| CliFailure::usage("portable package ZIP local entry overflow"))?;
        let data_end = data_start
            .checked_add(expanded)
            .ok_or_else(|| CliFailure::usage("portable package ZIP data overflow"))?;
        if local_offset >= central_offset || data_end > central_offset {
            return Err(CliFailure::usage(
                "portable package ZIP entry overlaps its central directory",
            ));
        }
        let local_name = bytes
            .get(local_offset + 30..local_offset + 30 + local_name_bytes)
            .ok_or_else(|| CliFailure::usage("portable package ZIP local name is truncated"))?;
        let data = bytes
            .get(data_start..data_end)
            .ok_or_else(|| CliFailure::usage("portable package ZIP entry data is truncated"))?;
        if local_name != name.as_bytes()
            || local_flags != flags
            || local_method != method
            || local_crc != expected_crc
            || local_compressed != compressed
            || local_expanded != expanded
            || crc32(data) != expected_crc
        {
            return Err(CliFailure::usage(
                "portable package ZIP entry integrity check failed",
            ));
        }
        if entries.insert(name.to_string(), data.to_vec()).is_some() {
            return Err(CliFailure::usage(
                "portable package ZIP contains duplicate paths",
            ));
        }
        occupied.push((local_offset, data_end));
        cursor = entry_end;
    }
    if cursor != eocd {
        return Err(CliFailure::usage(
            "portable package ZIP central directory length is invalid",
        ));
    }
    occupied.sort_unstable();
    if occupied.windows(2).any(|pair| pair[1].0 < pair[0].1) {
        return Err(CliFailure::usage("portable package ZIP entries overlap"));
    }
    Ok(entries)
}

fn validate_portable_package(path: &Path) -> Result<Value, CliFailure> {
    let bytes = read_bounded(path, MAX_PACKAGE_BYTES, "portable package")?;
    let archive = parse_stored_zip(&bytes)?;
    let manifest_bytes = archive
        .get("manifest.json")
        .ok_or_else(|| CliFailure::usage("portable package manifest.json is missing"))?;
    if manifest_bytes.len() > 256 * 1024 {
        return Err(CliFailure::usage(
            "portable package manifest exceeds its size budget",
        ));
    }
    let manifest: Value = serde_json::from_slice(manifest_bytes).map_err(|error| {
        CliFailure::usage(format!(
            "portable package manifest is invalid JSON: {error}"
        ))
    })?;
    if manifest.get("format").and_then(Value::as_str)
        != Some("org.sysadmindoc.cataclysm.scenario-package")
        || manifest.get("schema_version").and_then(Value::as_u64) != Some(1)
    {
        return Err(CliFailure::usage(
            "portable package format or schema is unsupported",
        ));
    }
    let root = manifest
        .get("root")
        .and_then(Value::as_object)
        .ok_or_else(|| CliFailure::usage("portable package manifest root is invalid"))?;
    for (role, expected) in [
        ("scenario", "scenario.json"),
        ("settings", "settings.json"),
        ("solver_settings", "solver-settings.json"),
        ("workspace", "workspace.json"),
        ("citations", "citations.json"),
        ("provenance", "provenance.json"),
    ] {
        if root.get(role).and_then(Value::as_str) != Some(expected) {
            return Err(CliFailure::usage(format!(
                "portable package root {role} is invalid"
            )));
        }
    }
    let declarations = manifest
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| CliFailure::usage("portable package manifest entries are invalid"))?;
    if declarations.is_empty() || declarations.len() + 1 != archive.len() {
        return Err(CliFailure::usage(
            "portable package contains undeclared or missing entries",
        ));
    }
    let allowed_roles = [
        "scenario",
        "settings",
        "solver_settings",
        "workspace",
        "citations",
        "provenance",
        "results",
        "checkpoints",
        "data_asset",
    ];
    let allowed_mimes = [
        "application/json",
        "application/octet-stream",
        "application/x-netcdf",
        "image/jpeg",
        "image/png",
        "image/tiff",
    ];
    let mut declared_paths = HashSet::with_capacity(declarations.len());
    for declaration in declarations {
        let path = declaration
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| CliFailure::usage("portable package entry path is invalid"))?;
        validate_package_path(path)?;
        if !declared_paths.insert(path) {
            return Err(CliFailure::usage(
                "portable package manifest declares duplicate paths",
            ));
        }
        let role = declaration
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("");
        let mime = declaration
            .get("mime")
            .and_then(Value::as_str)
            .unwrap_or("");
        let declared_bytes = declaration
            .get("bytes")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .ok_or_else(|| CliFailure::usage("portable package entry byte length is invalid"))?;
        let digest = declaration
            .get("sha256")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !allowed_roles.contains(&role)
            || !allowed_mimes.contains(&mime)
            || digest.len() != 64
            || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(CliFailure::usage(
                "portable package entry declaration is invalid",
            ));
        }
        let payload = archive
            .get(path)
            .ok_or_else(|| CliFailure::usage("portable package declared entry is missing"))?;
        if payload.len() != declared_bytes || crate::render_protocol::sha256_hex(payload) != digest
        {
            return Err(CliFailure::usage(
                "portable package entry digest or length does not match",
            ));
        }
        if mime == "application/json" {
            serde_json::from_slice::<Value>(payload).map_err(|error| {
                CliFailure::usage(format!(
                    "portable package entry {path} is invalid JSON: {error}"
                ))
            })?;
        }
    }
    for (role, path) in [
        ("scenario", "scenario.json"),
        ("settings", "settings.json"),
        ("solver_settings", "solver-settings.json"),
        ("workspace", "workspace.json"),
        ("citations", "citations.json"),
        ("provenance", "provenance.json"),
    ] {
        if !declarations.iter().any(|entry| {
            entry.get("path").and_then(Value::as_str) == Some(path)
                && entry.get("role").and_then(Value::as_str) == Some(role)
        }) {
            return Err(CliFailure::usage(format!(
                "portable package core entry {path} has the wrong or missing role"
            )));
        }
    }
    if !archive
        .keys()
        .all(|path| path == "manifest.json" || declared_paths.contains(path.as_str()))
    {
        return Err(CliFailure::usage(
            "portable package contains an undeclared entry",
        ));
    }
    let scenario = archive
        .get("scenario.json")
        .and_then(|payload| serde_json::from_slice::<Value>(payload).ok())
        .ok_or_else(|| CliFailure::usage("portable package scenario payload is invalid"))?;
    let solver_settings = archive
        .get("solver-settings.json")
        .and_then(|payload| serde_json::from_slice::<Value>(payload).ok())
        .ok_or_else(|| CliFailure::usage("portable package solver settings are invalid"))?;
    if solver_settings
        .get("schema_version")
        .and_then(Value::as_u64)
        != Some(1)
    {
        return Err(CliFailure::usage(
            "portable package solver settings schema is unsupported",
        ));
    }
    Ok(json!({
        "schema_version": CLI_SCHEMA_VERSION,
        "kind": "cataclysm_package_validation",
        "tool_version": env!("CARGO_PKG_VERSION"),
        "valid": true,
        "package_sha256": crate::render_protocol::sha256_hex(&bytes),
        "package_schema_version": 1,
        "app_version": manifest.get("app_version"),
        "entries": declarations.len(),
        "scenario_kind": scenario.pointer("/data/kind").or_else(|| scenario.get("kind")),
    }))
}

fn read_result(path: &Path) -> Result<Value, CliFailure> {
    let bytes = read_bounded(path, MAX_RESULT_BYTES, "run result")?;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|error| CliFailure::usage(format!("run result JSON is invalid: {error}")))?;
    if value.get("schema_version").and_then(Value::as_u64) != Some(u64::from(CLI_SCHEMA_VERSION))
        || value.get("kind").and_then(Value::as_str) != Some("cataclysm_run")
    {
        return Err(CliFailure::usage(
            "run result uses an unsupported schema or kind",
        ));
    }
    Ok(value)
}

fn default_data_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("XDG_DATA_HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Cataclysm")
        .join("cli")
}

fn data_dir(args: &ParsedArgs) -> PathBuf {
    args.options
        .get("data-dir")
        .map(PathBuf::from)
        .unwrap_or_else(default_data_dir)
}

fn request_digest(req: &SimulateGridRequest) -> Result<String, CliFailure> {
    serde_json::to_vec(req)
        .map(|bytes| crate::render_protocol::sha256_hex(&bytes))
        .map_err(|error| CliFailure::run(format!("failed to identify request: {error}")))
}

fn run_id(args: &ParsedArgs, digest: &str, prefix: &str) -> Result<String, CliFailure> {
    let value = args
        .options
        .get("run-id")
        .cloned()
        .unwrap_or_else(|| format!("{prefix}-{}", &digest[..16]));
    validate_run_id(&value).map_err(CliFailure::usage)?;
    Ok(value)
}

fn add_lamb_wave(grid: &mut SwGrid, req: &SimulateGridRequest, plan: &SimulationGridPlan) {
    if !req.include_lamb_wave {
        return;
    }
    let mut lamb = crate::physics::lamb_wave::LambWaveSource::hunga_tonga_2022();
    if let Some(value) = req.lamb_wave_peak_pressure_pa {
        lamb.peak_pressure_pa = value;
    }
    if let Some(value) = req.lamb_wave_source_radius_m {
        lamb.source_radius_m = value;
    }
    grid.apply_lamb_wave(&lamb, plan.lat, plan.lon, 0.0);
}

fn headless_simulate(
    app_data_dir: &Path,
    run_id: &str,
    resume_run_id: Option<&str>,
    req: &SimulateGridRequest,
    cancel: &AtomicBool,
) -> Result<SimulateGridResponse, String> {
    validate_simulate_grid(req)?;
    fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("failed to create CLI data directory: {error}"))?;
    let resolution_preflight = build_resolution_preflight(req)?;
    let plan = SimulationGridPlan::from_request(req)?;
    let mut grid = SwGrid::new(
        plan.west,
        plan.south,
        plan.east,
        plan.north,
        plan.cell_deg,
        plan.cell_deg,
    );
    grid.colormap = match req.colormap.as_str() {
        "cividis" => Colormap::Cividis,
        "viridis" => Colormap::Viridis,
        _ => Colormap::Diverging,
    };
    populate_grid_bathymetry(&mut grid, req, Some(app_data_dir))?;
    inject_source_initial_field(&mut grid, req)?;
    add_lamb_wave(&mut grid, req, &plan);

    let dt = grid.recommended_dt_s(0.4);
    let snapshot_schedule = snapshot_step_schedule(req.t_end_s, dt, req.n_snapshots);
    let work = (grid.nx as u64)
        .saturating_mul(grid.ny as u64)
        .saturating_mul(
            snapshot_schedule
                .iter()
                .fold(0_u64, |total, steps| total.saturating_add(*steps as u64)),
        );
    if work > SWE_MAX_CELL_STEPS {
        return Err(format!(
            "simulation too expensive (~{work} cell-steps; cap {SWE_MAX_CELL_STEPS})"
        ));
    }
    let boundary = parse_boundary_mode(req);
    let quality_baseline = if req.meteotsunami_forcing.is_some() {
        QualityBaseline::capture_with_external_forcing(&grid, boundary)
    } else {
        QualityBaseline::capture(&grid, boundary)
    };
    let admission_quality = quality_baseline.assess(&grid, dt);
    if let Some(failure) = &admission_quality.failure {
        return Err(format!(
            "simulation rejected by numerical-integrity admission gate: {failure}"
        ));
    }

    let checkpoint_interval = validate_checkpoint_interval(Some(60))?;
    let checkpoint_writer = RefCell::new(StreamCheckpointWriter::new(
        app_data_dir.to_path_buf(),
        run_id,
        req,
        dt,
        checkpoint_interval,
    )?);
    let resumed = resume_run_id
        .map(|resume_id| {
            let checkpoint =
                crate::physics::solver::checkpoint::load_latest(app_data_dir, resume_id)?;
            verify_resume_checkpoint(
                &checkpoint,
                &checkpoint_writer.borrow().identity,
                &req.gauge_points,
                &grid,
                &snapshot_schedule,
            )?;
            Ok::<_, String>(checkpoint)
        })
        .transpose()?;
    let (start_interval, restored_max_field) = if let Some(checkpoint) = resumed {
        let start = checkpoint.identity.next_snapshot_interval as usize;
        checkpoint_writer
            .borrow_mut()
            .restore_gauge_history(checkpoint.gauge_history);
        grid = checkpoint.grid;
        (start, Some(checkpoint.max_field))
    } else {
        (0, None)
    };
    checkpoint_writer
        .borrow_mut()
        .identity
        .next_snapshot_interval = start_interval.min(u32::MAX as usize) as u32;

    let mut snapshots = vec![grid.snapshot_with_gauge_samples(&req.gauge_points, None)];
    if start_interval == 0 {
        checkpoint_writer.borrow_mut().record_gauges(&grid);
    }
    let max_field = RefCell::new(restored_max_field.unwrap_or_else(|| {
        let mut value = MaxFieldAccumulator::new(
            grid.nx * grid.ny,
            MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m),
        );
        value.observe(&grid);
        value
    }));
    let stepper = TimeStepper::new(dt).with_boundary(boundary);
    for (offset, &take) in snapshot_schedule.iter().enumerate().skip(start_interval) {
        if cancel.load(Ordering::Acquire) {
            break;
        }
        if take > 0 {
            // Cancellation may be observed partway through an interval. Keep
            // the previous deterministic snapshot boundary so the forced
            // checkpoint is always verifiable and resumable.
            let interval_grid = grid.clone();
            let interval_max_field = max_field.borrow().clone();
            match stepper.step_cancellable_checked_forced(
                &mut grid,
                take,
                Some(cancel),
                &quality_baseline,
                req.meteotsunami_forcing.as_ref(),
                &mut |state| max_field.borrow_mut().observe(state),
            ) {
                Ok(true) => {}
                Ok(false) => {
                    grid = interval_grid;
                    *max_field.borrow_mut() = interval_max_field;
                    break;
                }
                Err(quality) => {
                    return Err(format!(
                        "simulation rejected at step {}: {}",
                        quality.accepted_steps,
                        quality
                            .failure
                            .unwrap_or_else(|| "unknown numerical-integrity violation".into())
                    ));
                }
            }
        }
        snapshots.push(grid.snapshot_with_gauge_samples(&req.gauge_points, None));
        checkpoint_writer.borrow_mut().record_gauges(&grid);
        checkpoint_writer.borrow_mut().maybe_write(
            &grid,
            &max_field.borrow(),
            offset.saturating_add(1),
            false,
            None,
        );
    }
    let run_quality = quality_baseline.assess(&grid, dt);
    if let Some(failure) = &run_quality.failure {
        return Err(format!(
            "simulation rejected by numerical-integrity gate: {failure}"
        ));
    }
    let cancelled = cancel.load(Ordering::Acquire);
    if cancelled {
        let next_interval = checkpoint_writer.borrow().identity.next_snapshot_interval as usize;
        checkpoint_writer.borrow_mut().record_gauges(&grid);
        checkpoint_writer.borrow_mut().maybe_write(
            &grid,
            &max_field.borrow(),
            next_interval,
            true,
            None,
        );
    } else {
        checkpoint_writer.borrow().remove_completed();
        if let Some(resume_id) = resume_run_id {
            let _ = crate::physics::solver::checkpoint::remove(app_data_dir, resume_id);
        }
    }
    let (scientific_export, scientific_export_error) = if cancelled {
        (
            None,
            Some("scientific export is unavailable for a cancelled run".to_string()),
        )
    } else {
        let fields = max_field.borrow();
        let context = ScientificExportContext::new(
            run_id,
            req,
            &grid,
            &fields,
            &run_quality,
            false,
            &resolution_preflight,
        );
        match create_cached_scientific_export(app_data_dir, &context) {
            Ok(descriptor) => (Some(descriptor), None),
            Err(error) => (None, Some(error)),
        }
    };
    let max_field = max_field.into_inner().into_product(&grid, None);
    Ok(SimulateGridResponse {
        run_id: run_id.to_string(),
        lifecycle: if cancelled {
            SimulationRunLifecycle::Cancelled
        } else {
            SimulationRunLifecycle::Completed
        },
        emitted_snapshots: snapshots.len().min(u32::MAX as usize) as u32,
        cancelled,
        snapshots,
        dt_s: dt,
        nx: grid.nx as u32,
        ny: grid.ny as u32,
        resolution_preflight,
        bathymetry_asset_id: req.bathymetry_asset_id.clone(),
        used_gpu: false,
        max_field: Some(max_field),
        scientific_export,
        scientific_export_error,
        run_quality,
    })
}

fn emit_progress(command: &str, phase: &str) {
    eprintln!(
        "{}",
        json!({
            "schema_version": CLI_SCHEMA_VERSION,
            "kind": "progress",
            "command": command,
            "phase": phase,
        })
    );
}

fn run_with_cancel_file(
    app_data_dir: &Path,
    run_id: &str,
    resume_run_id: Option<&str>,
    req: &SimulateGridRequest,
    cancel_file: Option<&Path>,
) -> Result<SimulateGridResponse, String> {
    let cancel = Arc::new(AtomicBool::new(cancel_file.is_some_and(Path::exists)));
    let finished = Arc::new(AtomicBool::new(false));
    let watcher = cancel_file.map(|path| {
        let path = path.to_path_buf();
        let cancel = Arc::clone(&cancel);
        let finished = Arc::clone(&finished);
        thread::spawn(move || {
            while !finished.load(Ordering::Acquire) {
                if path.exists() {
                    cancel.store(true, Ordering::Release);
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
        })
    });
    let result = headless_simulate(app_data_dir, run_id, resume_run_id, req, cancel.as_ref());
    finished.store(true, Ordering::Release);
    if let Some(watcher) = watcher {
        let _ = watcher.join();
    }
    result
}

fn run_artifact(
    command: &str,
    scenario: CliScenarioFile,
    result: SimulateGridResponse,
    request_sha256: String,
    resume_run_id: Option<&str>,
) -> Result<Value, CliFailure> {
    let result = serde_json::to_value(result)
        .map_err(|error| CliFailure::run(format!("failed to serialize solver result: {error}")))?;
    Ok(json!({
        "schema_version": CLI_SCHEMA_VERSION,
        "kind": "cataclysm_run",
        "command": command,
        "tool_version": env!("CARGO_PKG_VERSION"),
        "request_sha256": request_sha256,
        "request": scenario.request,
        "resume_run_id": resume_run_id,
        "result": result,
    }))
}

fn result_export_id(result: &Value) -> Result<&str, CliFailure> {
    result
        .pointer("/result/scientific_export/export_id")
        .and_then(Value::as_str)
        .ok_or_else(|| CliFailure::usage("run result has no retained scientific export"))
}

fn execute(args: &ParsedArgs) -> Result<(Value, i32), CliFailure> {
    match args.command.as_str() {
        "validate" => {
            reject_unknown(args, &["input", "package", "output"])?;
            if let Some(package) = args.options.get("package") {
                if args.options.contains_key("input") {
                    return Err(CliFailure::usage(
                        "validate accepts exactly one of --input or --package",
                    ));
                }
                return validate_portable_package(Path::new(package)).map(|value| (value, 0));
            }
            let scenario = read_scenario(Path::new(option(args, "input")?))?;
            let digest = request_digest(&scenario.request)?;
            let preflight =
                build_resolution_preflight(&scenario.request).map_err(CliFailure::usage)?;
            Ok((
                json!({
                    "schema_version": CLI_SCHEMA_VERSION,
                    "kind": "cataclysm_validation",
                    "tool_version": env!("CARGO_PKG_VERSION"),
                    "request_sha256": digest,
                    "valid": true,
                    "resolution_preflight": preflight,
                }),
                0,
            ))
        }
        "run" | "resume" => {
            reject_unknown(
                args,
                &[
                    "input",
                    "output",
                    "data-dir",
                    "run-id",
                    "resume-run-id",
                    "cancel-file",
                ],
            )?;
            let scenario = read_scenario(Path::new(option(args, "input")?))?;
            let digest = request_digest(&scenario.request)?;
            let run_id = run_id(
                args,
                &digest,
                if args.command == "resume" {
                    "resume"
                } else {
                    "run"
                },
            )?;
            let resume_run_id = if args.command == "resume" {
                Some(option(args, "resume-run-id")?)
            } else {
                if args.options.contains_key("resume-run-id") {
                    return Err(CliFailure::usage(
                        "--resume-run-id is valid only for resume",
                    ));
                }
                None
            };
            if let Some(value) = resume_run_id {
                validate_run_id(value).map_err(CliFailure::usage)?;
            }
            let root = data_dir(args);
            let cancel_file = args.options.get("cancel-file").map(Path::new);
            emit_progress(&args.command, "running");
            let response = run_with_cancel_file(
                &root,
                &run_id,
                resume_run_id,
                &scenario.request,
                cancel_file,
            )
            .map_err(CliFailure::run)?;
            let cancelled = response.cancelled;
            let artifact = run_artifact(&args.command, scenario, response, digest, resume_run_id)?;
            Ok((artifact, if cancelled { 130 } else { 0 }))
        }
        "compare" => {
            reject_unknown(args, &["left", "right", "output"])?;
            let left = read_result(Path::new(option(args, "left")?))?;
            let right = read_result(Path::new(option(args, "right")?))?;
            let left_digest = left
                .get("request_sha256")
                .and_then(Value::as_str)
                .unwrap_or("");
            let right_digest = right
                .get("request_sha256")
                .and_then(Value::as_str)
                .unwrap_or("");
            let metric =
                |value: &Value, pointer: &str| value.pointer(pointer).and_then(Value::as_f64);
            let delta = |pointer: &str| match (metric(&left, pointer), metric(&right, pointer)) {
                (Some(a), Some(b)) => Some(b - a),
                _ => None,
            };
            Ok((
                json!({
                    "schema_version": CLI_SCHEMA_VERSION,
                    "kind": "cataclysm_comparison",
                    "tool_version": env!("CARGO_PKG_VERSION"),
                    "attribution": if left_digest != right_digest { "inputs" } else if left.get("tool_version") != right.get("tool_version") { "solver_version" } else { "same_version_repeat" },
                    "left_request_sha256": left_digest,
                    "right_request_sha256": right_digest,
                    "deltas": {
                        "dt_s": delta("/result/dt_s"),
                        "mass_drift_pct": delta("/result/run_quality/mass_drift_pct"),
                        "energy_drift_pct": delta("/result/run_quality/energy_drift_pct"),
                        "peak_abs_max_m": delta("/result/max_field/peak_abs_max_m"),
                    },
                    "same_grid": left.pointer("/result/nx") == right.pointer("/result/nx") && left.pointer("/result/ny") == right.pointer("/result/ny"),
                }),
                0,
            ))
        }
        "inspect" => {
            reject_unknown(args, &["result", "lat", "lon", "data-dir", "output"])?;
            let result = read_result(Path::new(option(args, "result")?))?;
            let lat = option(args, "lat")?
                .parse::<f64>()
                .map_err(|_| CliFailure::usage("--lat must be a number"))?;
            let lon = option(args, "lon")?
                .parse::<f64>()
                .map_err(|_| CliFailure::usage("--lon must be a number"))?;
            let export_id = result_export_id(&result)?;
            let probe = probe_scientific_export(&data_dir(args), export_id, lat, lon)
                .map_err(CliFailure::run)?;
            Ok((
                json!({
                    "schema_version": CLI_SCHEMA_VERSION,
                    "kind": "cataclysm_inspection",
                    "tool_version": env!("CARGO_PKG_VERSION"),
                    "export_id": export_id,
                    "probe": probe,
                }),
                0,
            ))
        }
        "export" => {
            reject_unknown(
                args,
                &["result", "kind", "destination", "data-dir", "output"],
            )?;
            let result = read_result(Path::new(option(args, "result")?))?;
            let export_id = result_export_id(&result)?;
            let kind = option(args, "kind")?;
            let destination = PathBuf::from(option(args, "destination")?);
            let bytes =
                save_cached_scientific_export(&data_dir(args), export_id, &destination, kind)
                    .map_err(CliFailure::run)?;
            Ok((
                json!({
                    "schema_version": CLI_SCHEMA_VERSION,
                    "kind": "cataclysm_export",
                    "tool_version": env!("CARGO_PKG_VERSION"),
                    "export_id": export_id,
                    "format": kind,
                    "destination": destination,
                    "bytes": bytes,
                }),
                0,
            ))
        }
        "benchmark" => {
            reject_unknown(args, &["input", "iterations", "data-dir", "output"])?;
            let scenario = read_scenario(Path::new(option(args, "input")?))?;
            let digest = request_digest(&scenario.request)?;
            let iterations = args
                .options
                .get("iterations")
                .map(String::as_str)
                .unwrap_or("3")
                .parse::<usize>()
                .map_err(|_| CliFailure::usage("--iterations must be an integer"))?;
            if !(1..=25).contains(&iterations) {
                return Err(CliFailure::usage("--iterations must be in [1, 25]"));
            }
            let root = data_dir(args);
            let cancel = AtomicBool::new(false);
            let mut elapsed_ms = Vec::with_capacity(iterations);
            let mut last = None;
            for index in 0..iterations {
                emit_progress("benchmark", &format!("iteration_{}", index + 1));
                let start = Instant::now();
                let response = headless_simulate(
                    &root,
                    &format!("benchmark-{}-{index}", &digest[..12]),
                    None,
                    &scenario.request,
                    &cancel,
                )
                .map_err(CliFailure::run)?;
                elapsed_ms.push(start.elapsed().as_secs_f64() * 1_000.0);
                last = Some(response);
            }
            elapsed_ms.sort_by(f64::total_cmp);
            let total: f64 = elapsed_ms.iter().sum();
            let last = last.expect("at least one benchmark iteration");
            Ok((
                json!({
                    "schema_version": CLI_SCHEMA_VERSION,
                    "kind": "cataclysm_benchmark",
                    "tool_version": env!("CARGO_PKG_VERSION"),
                    "request_sha256": digest,
                    "iterations": iterations,
                    "elapsed_ms": elapsed_ms,
                    "mean_ms": total / iterations as f64,
                    "median_ms": elapsed_ms[iterations / 2],
                    "grid": { "nx": last.nx, "ny": last.ny, "dt_s": last.dt_s },
                    "quality": last.run_quality,
                }),
                0,
            ))
        }
        _ => Err(CliFailure::usage(format!(
            "unknown command '{}'",
            args.command
        ))),
    }
}

fn write_output(
    args: &ParsedArgs,
    value: &Value,
    stdout: &mut dyn Write,
) -> Result<(), CliFailure> {
    let encoded = serde_json::to_vec_pretty(value)
        .map_err(|error| CliFailure::run(format!("failed to serialize output: {error}")))?;
    if let Some(path) = args.options.get("output") {
        let path = Path::new(path);
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        if !parent.is_dir() {
            return Err(CliFailure::io("output parent directory does not exist"));
        }
        let temporary = path.with_extension("cataclysm.tmp");
        fs::write(&temporary, [&encoded[..], b"\n"].concat())
            .map_err(|error| CliFailure::io(format!("failed to write output: {error}")))?;
        fs::rename(&temporary, path)
            .map_err(|error| CliFailure::io(format!("failed to publish output: {error}")))?;
    } else {
        stdout
            .write_all(&encoded)
            .and_then(|_| stdout.write_all(b"\n"))
            .map_err(|error| CliFailure::io(format!("failed to write stdout: {error}")))?;
    }
    Ok(())
}

fn run_with_io(
    args: impl IntoIterator<Item = OsString>,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> i32 {
    let parsed = match parse_args(args) {
        Ok(Some(parsed)) => parsed,
        Ok(None) => {
            let _ = stdout.write_all(help_text().as_bytes());
            return 0;
        }
        Err(error) => {
            let _ = writeln!(
                stderr,
                "{}",
                json!({ "schema_version": CLI_SCHEMA_VERSION, "kind": "error", "message": error.message })
            );
            return error.exit_code;
        }
    };
    match execute(&parsed).and_then(|(value, exit_code)| {
        write_output(&parsed, &value, stdout)?;
        Ok(exit_code)
    }) {
        Ok(exit_code) => exit_code,
        Err(error) => {
            let _ = writeln!(
                stderr,
                "{}",
                json!({
                    "schema_version": CLI_SCHEMA_VERSION,
                    "kind": "error",
                    "command": parsed.command,
                    "message": error.message,
                })
            );
            error.exit_code
        }
    }
}

pub fn run_headless_cli(args: impl IntoIterator<Item = OsString>) -> i32 {
    run_with_io(args, &mut io::stdout().lock(), &mut io::stderr().lock())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn request() -> SimulateGridRequest {
        serde_json::from_value(json!({
            "source": { "lat_deg": 0.0, "lon_deg": 0.0 },
            "initial_amplitude_m": 1.0,
            "source_sigma_m": 10000.0,
            "mean_depth_m": 4000.0,
            "use_real_bathymetry": false,
            "box_half_size_deg": 0.5,
            "cells_per_deg": 2.0,
            "resolution_mode": "advanced",
            "t_end_s": 10.0,
            "n_snapshots": 3,
            "include_lamb_wave": false,
            "colormap": "diverging",
            "gauge_points": [],
            "boundary_mode": "sponge"
        }))
        .unwrap()
    }

    #[test]
    fn future_scenario_schema_fails_closed() {
        let root = tempdir().unwrap();
        let input = root.path().join("scenario.json");
        fs::write(
            &input,
            serde_json::to_vec(&json!({
                "schema_version": 2,
                "request": request(),
            }))
            .unwrap(),
        )
        .unwrap();
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = run_with_io(
            [
                OsString::from("validate"),
                OsString::from("--input"),
                input.into_os_string(),
            ],
            &mut stdout,
            &mut stderr,
        );
        assert_eq!(code, 2);
        assert!(stdout.is_empty());
        assert!(String::from_utf8(stderr).unwrap().contains("unsupported"));
    }

    #[test]
    fn cancelled_checkpoint_resumes_to_authoritative_uninterrupted_result() {
        let root = tempdir().unwrap();
        let req = request();
        let cancel = AtomicBool::new(true);
        let cancelled = headless_simulate(root.path(), "cancelled", None, &req, &cancel).unwrap();
        assert!(cancelled.cancelled);
        assert_eq!(
            crate::physics::solver::checkpoint::list(root.path())
                .unwrap()
                .len(),
            1
        );

        let resumed = headless_simulate(
            root.path(),
            "resumed",
            Some("cancelled"),
            &req,
            &AtomicBool::new(false),
        )
        .unwrap();
        let uninterrupted = headless_simulate(
            root.path(),
            "uninterrupted",
            None,
            &req,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(!resumed.cancelled);
        assert_eq!(resumed.dt_s.to_bits(), uninterrupted.dt_s.to_bits());
        assert_eq!(resumed.nx, uninterrupted.nx);
        assert_eq!(resumed.ny, uninterrupted.ny);
        assert_eq!(
            resumed.snapshots.last().unwrap().eta_abs_max_m.to_bits(),
            uninterrupted
                .snapshots
                .last()
                .unwrap()
                .eta_abs_max_m
                .to_bits()
        );
        assert_eq!(
            resumed.run_quality.mass_drift_pct.to_bits(),
            uninterrupted.run_quality.mass_drift_pct.to_bits()
        );
    }

    #[test]
    fn validate_command_emits_versioned_deterministic_json() {
        let root = tempdir().unwrap();
        let input = root.path().join("scenario.json");
        fs::write(
            &input,
            serde_json::to_vec(&CliScenarioFile {
                schema_version: CLI_SCHEMA_VERSION,
                request: request(),
            })
            .unwrap(),
        )
        .unwrap();
        let args = [
            OsString::from("validate"),
            OsString::from("--input"),
            input.into_os_string(),
        ];
        let mut first = Vec::new();
        let mut second = Vec::new();
        assert_eq!(run_with_io(args.clone(), &mut first, &mut Vec::new()), 0);
        assert_eq!(run_with_io(args, &mut second, &mut Vec::new()), 0);
        assert_eq!(first, second);
        let value: Value = serde_json::from_slice(&first).unwrap();
        assert_eq!(value["schema_version"], CLI_SCHEMA_VERSION);
        assert_eq!(value["valid"], true);
    }

    #[test]
    fn headless_run_matches_the_gui_solver_dispatch_fixture() {
        let root = tempdir().unwrap();
        let req = request();
        let plan = SimulationGridPlan::from_request(&req).unwrap();
        let mut grid = SwGrid::new(
            plan.west,
            plan.south,
            plan.east,
            plan.north,
            plan.cell_deg,
            plan.cell_deg,
        );
        grid.colormap = Colormap::Diverging;
        populate_grid_bathymetry(&mut grid, &req, Some(root.path())).unwrap();
        inject_source_initial_field(&mut grid, &req).unwrap();
        let dt = grid.recommended_dt_s(0.4);
        let (gui_snapshots, _used_gpu, _max_field) = run_simulation_dispatch(
            &mut grid,
            dt,
            req.t_end_s,
            req.n_snapshots,
            &AtomicBool::new(false),
            None,
            &req.gauge_points,
            MaxFieldAccumulator::threshold_for_amplitude(req.initial_amplitude_m),
            req.meteotsunami_forcing.as_ref(),
        );
        let cli = headless_simulate(
            root.path(),
            "gui-cli-golden",
            None,
            &req,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(cli.snapshots.len(), gui_snapshots.len());
        for (cli_frame, gui_frame) in cli.snapshots.iter().zip(gui_snapshots) {
            assert_eq!(cli_frame.time_s.to_bits(), gui_frame.time_s.to_bits());
            assert_eq!(cli_frame.eta_min_m.to_bits(), gui_frame.eta_min_m.to_bits());
            assert_eq!(cli_frame.eta_max_m.to_bits(), gui_frame.eta_max_m.to_bits());
            assert_eq!(
                cli_frame.eta_abs_max_m.to_bits(),
                gui_frame.eta_abs_max_m.to_bits()
            );
            assert_eq!(cli_frame.eta_png_b64, gui_frame.eta_png_b64);
        }
    }

    #[test]
    fn portable_package_paths_reject_traversal_and_executable_content() {
        assert!(validate_package_path("../scenario.json").is_err());
        assert!(validate_package_path("payload/run.exe").is_err());
        assert!(validate_package_path("scenario.json").is_ok());
    }
}
