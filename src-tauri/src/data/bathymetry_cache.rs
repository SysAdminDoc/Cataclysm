//! Atomic local cache for preflighted user-supplied bathymetry rasters.

use std::{
    cmp::Reverse,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::bathymetry_import::{
    BathymetryPreflight, BathymetryPreflightRequest, BathymetryRaster, BathymetryRasterFormat,
    decode_bathymetry_raster, preflight_bathymetry_import, sha256_file,
};

const CACHE_SCHEMA_VERSION: u32 = 1;
const MAX_CACHED_ASSETS: usize = 8;
const MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportedBathymetryAsset {
    pub schema_version: u32,
    pub asset_id: String,
    pub imported_at_ms: u64,
    pub cache_file: String,
    pub report: BathymetryPreflight,
}

fn cache_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("bathymetry").join("imports")
}

fn trash_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("bathymetry").join("trash")
}

fn extension(format: BathymetryRasterFormat) -> &'static str {
    match format {
        BathymetryRasterFormat::GeoTiff => "tif",
        BathymetryRasterFormat::NetCdf => "nc",
    }
}

fn asset_id(sha256: &str) -> String {
    format!("local-bathymetry-{sha256}")
}

fn validate_sha256(value: &str) -> Result<(), String> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("bathymetry SHA-256 must be 64 lowercase hexadecimal characters".into());
    }
    Ok(())
}

pub(crate) fn validate_asset_id(value: &str) -> Result<&str, String> {
    let digest = value
        .strip_prefix("local-bathymetry-")
        .ok_or_else(|| "invalid local bathymetry asset id".to_owned())?;
    validate_sha256(digest)?;
    Ok(digest)
}

fn expected_cache_file(asset: &ImportedBathymetryAsset) -> Result<String, String> {
    let digest = validate_asset_id(&asset.asset_id)?;
    if digest != asset.report.sha256 {
        return Err("bathymetry manifest id does not match its SHA-256".into());
    }
    Ok(format!("{digest}.{}", extension(asset.report.format)))
}

fn read_manifest(path: &Path) -> Result<ImportedBathymetryAsset, String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("bathymetry manifest metadata is unavailable: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_MANIFEST_BYTES {
        return Err("bathymetry manifest has an invalid size".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|error| format!("bathymetry manifest could not be read: {error}"))?;
    let asset: ImportedBathymetryAsset = serde_json::from_slice(&bytes)
        .map_err(|error| format!("bathymetry manifest is invalid: {error}"))?;
    if asset.schema_version != CACHE_SCHEMA_VERSION {
        return Err("bathymetry manifest schema is unsupported".into());
    }
    let expected = expected_cache_file(&asset)?;
    if asset.cache_file != expected {
        return Err("bathymetry manifest cache filename is invalid".into());
    }
    Ok(asset)
}

pub(crate) fn load_cached_raster(
    app_data_dir: &Path,
    id: &str,
) -> Result<(ImportedBathymetryAsset, BathymetryRaster), String> {
    validate_asset_id(id)?;
    let root = cache_root(app_data_dir);
    let asset = read_manifest(&root.join(format!("{id}.json")))?;
    if asset.asset_id != id {
        return Err("bathymetry manifest identity does not match the requested asset".into());
    }
    let source = root.join(&asset.cache_file);
    let metadata = source
        .metadata()
        .map_err(|error| format!("bathymetry cached source is unavailable: {error}"))?;
    if !metadata.is_file() || metadata.len() != asset.report.file_size_bytes {
        return Err("bathymetry cached source size no longer matches its manifest".into());
    }
    if sha256_file(&source)? != asset.report.sha256 {
        return Err("bathymetry cached source checksum no longer matches its manifest".into());
    }
    let raster = decode_bathymetry_raster(
        &source,
        asset.report.format,
        Some(&asset.report.variable),
        asset.report.sample_semantics,
    )?;
    if raster.width != asset.report.width
        || raster.height != asset.report.height
        || raster.bounds_wgs84 != asset.report.bounds_wgs84
        || raster.resolution_deg != asset.report.resolution_deg
    {
        return Err("bathymetry cached source metadata no longer matches its manifest".into());
    }
    Ok((asset, raster))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "bathymetry manifest filename is invalid".to_owned())?;
    let temporary = path.with_file_name(format!(".{file_name}.tmp-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("bathymetry temporary manifest could not be created: {error}"))?;
    let result = (|| {
        file.write_all(bytes)
            .map_err(|error| format!("bathymetry manifest write failed: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("bathymetry manifest sync failed: {error}"))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("bathymetry manifest commit failed: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn list_from_root(root: &Path) -> Result<Vec<ImportedBathymetryAsset>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut manifests = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("bathymetry cache could not be listed: {error}"))?
    {
        let entry = entry.map_err(|error| format!("bathymetry cache entry is invalid: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let asset = read_manifest(&path)?;
        let source = root.join(&asset.cache_file);
        let metadata = source.metadata().map_err(|error| {
            format!(
                "bathymetry cached source is unavailable for {}: {error}",
                asset.asset_id
            )
        })?;
        if !metadata.is_file() || metadata.len() != asset.report.file_size_bytes {
            return Err(format!(
                "bathymetry cached source is invalid for {}",
                asset.asset_id
            ));
        }
        manifests.push(asset);
        if manifests.len() > MAX_CACHED_ASSETS {
            return Err("bathymetry cache contains more manifests than its supported limit".into());
        }
    }
    manifests.sort_by_key(|asset| Reverse(asset.imported_at_ms));
    Ok(manifests)
}

fn ensure_quota(root: &Path, incoming: u64) -> Result<(), String> {
    let assets = list_from_root(root)?;
    if assets.len() >= MAX_CACHED_ASSETS {
        return Err(format!(
            "bathymetry cache already contains the maximum of {MAX_CACHED_ASSETS} imports"
        ));
    }
    let used = assets.iter().try_fold(0_u64, |total, asset| {
        total
            .checked_add(asset.report.file_size_bytes)
            .ok_or_else(|| "bathymetry cache size overflow".to_owned())
    })?;
    if used.saturating_add(incoming) > MAX_CACHE_BYTES {
        return Err(format!(
            "bathymetry cache would exceed {MAX_CACHE_BYTES} bytes"
        ));
    }
    Ok(())
}

fn copy_atomic(source: &Path, destination: &Path, expected_sha256: &str) -> Result<(), String> {
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "bathymetry cache filename is invalid".to_owned())?;
    let temporary = destination.with_file_name(format!(".{file_name}.tmp-{}", std::process::id()));
    let mut input = File::open(source)
        .map_err(|error| format!("bathymetry source could not be reopened: {error}"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| {
            format!("bathymetry cache temporary file could not be created: {error}")
        })?;
    let result = (|| {
        std::io::copy(&mut input, &mut output)
            .map_err(|error| format!("bathymetry cache copy failed: {error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("bathymetry cache sync failed: {error}"))?;
        let actual = sha256_file(&temporary)?;
        if actual != expected_sha256 {
            return Err("bathymetry source changed after preflight; run preflight again".into());
        }
        fs::rename(&temporary, destination)
            .map_err(|error| format!("bathymetry cache commit failed: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(crate) fn import_into_root(
    app_data_dir: &Path,
    req: BathymetryPreflightRequest,
    expected_sha256: &str,
) -> Result<ImportedBathymetryAsset, String> {
    validate_sha256(expected_sha256)?;
    let report = preflight_bathymetry_import(req.clone())?;
    if report.sha256 != expected_sha256 {
        return Err("bathymetry file changed after preview; run preflight again".into());
    }
    let id = asset_id(&report.sha256);
    let root = cache_root(app_data_dir);
    fs::create_dir_all(&root)
        .map_err(|error| format!("bathymetry cache directory could not be created: {error}"))?;
    let manifest_path = root.join(format!("{id}.json"));
    if manifest_path.exists() {
        return read_manifest(&manifest_path);
    }
    ensure_quota(&root, report.file_size_bytes)?;

    let cache_file = format!("{}.{}", report.sha256, extension(report.format));
    let source_path = Path::new(&req.path)
        .canonicalize()
        .map_err(|error| format!("bathymetry source is unavailable: {error}"))?;
    let cache_path = root.join(&cache_file);
    let copied_source = if cache_path.exists() {
        if sha256_file(&cache_path)? != report.sha256 {
            return Err("bathymetry cache contains a conflicting source artifact".into());
        }
        false
    } else {
        copy_atomic(&source_path, &cache_path, &report.sha256)?;
        true
    };

    let imported_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before the Unix epoch")?
        .as_millis()
        .try_into()
        .map_err(|_| "bathymetry import timestamp overflow")?;
    let asset = ImportedBathymetryAsset {
        schema_version: CACHE_SCHEMA_VERSION,
        asset_id: id,
        imported_at_ms,
        cache_file,
        report,
    };
    let manifest = serde_json::to_vec_pretty(&asset)
        .map_err(|error| format!("bathymetry manifest could not be encoded: {error}"))?;
    if let Err(error) = write_atomic(&manifest_path, &manifest) {
        if copied_source {
            let _ = fs::remove_file(&cache_path);
        }
        return Err(error);
    }
    Ok(asset)
}

pub(crate) fn remove_from_root(app_data_dir: &Path, id: &str) -> Result<(), String> {
    validate_asset_id(id)?;
    let root = cache_root(app_data_dir);
    let manifest_path = root.join(format!("{id}.json"));
    let asset = read_manifest(&manifest_path)?;
    let source_path = root.join(&asset.cache_file);
    let destination = trash_root(app_data_dir).join(id);
    if destination.exists() {
        return Err("bathymetry trash already contains this asset".into());
    }
    fs::create_dir_all(&destination)
        .map_err(|error| format!("bathymetry trash could not be created: {error}"))?;
    let trashed_source = destination.join(&asset.cache_file);
    if let Err(error) = fs::rename(&source_path, &trashed_source) {
        let _ = fs::remove_dir(&destination);
        return Err(format!(
            "bathymetry source could not be moved to trash: {error}"
        ));
    }
    if let Err(error) = fs::rename(&manifest_path, destination.join("manifest.json")) {
        let _ = fs::rename(&trashed_source, &source_path);
        let _ = fs::remove_dir(&destination);
        return Err(format!(
            "bathymetry manifest could not be moved to trash: {error}"
        ));
    }
    Ok(())
}

pub(crate) fn restore_from_root(
    app_data_dir: &Path,
    id: &str,
) -> Result<ImportedBathymetryAsset, String> {
    validate_asset_id(id)?;
    let root = cache_root(app_data_dir);
    fs::create_dir_all(&root)
        .map_err(|error| format!("bathymetry cache directory could not be created: {error}"))?;
    let trashed = trash_root(app_data_dir).join(id);
    let trashed_manifest = trashed.join("manifest.json");
    let asset = read_manifest(&trashed_manifest)?;
    let manifest_path = root.join(format!("{id}.json"));
    let source_path = root.join(&asset.cache_file);
    if manifest_path.exists() || source_path.exists() {
        return Err("bathymetry cache already contains this asset".into());
    }
    ensure_quota(&root, asset.report.file_size_bytes)?;
    fs::rename(trashed.join(&asset.cache_file), &source_path)
        .map_err(|error| format!("bathymetry source could not be restored: {error}"))?;
    if let Err(error) = fs::rename(&trashed_manifest, &manifest_path) {
        let _ = fs::rename(&source_path, trashed.join(&asset.cache_file));
        return Err(format!(
            "bathymetry manifest could not be restored: {error}"
        ));
    }
    let _ = fs::remove_dir(&trashed);
    Ok(asset)
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("application data directory is unavailable: {error}"))
}

#[tauri::command]
pub fn import_bathymetry(
    app: tauri::AppHandle,
    req: BathymetryPreflightRequest,
    expected_sha256: String,
) -> Result<ImportedBathymetryAsset, String> {
    import_into_root(&app_data_dir(&app)?, req, &expected_sha256)
}

#[tauri::command]
pub fn list_imported_bathymetry(
    app: tauri::AppHandle,
) -> Result<Vec<ImportedBathymetryAsset>, String> {
    list_from_root(&cache_root(&app_data_dir(&app)?))
}

#[tauri::command]
pub fn remove_imported_bathymetry(app: tauri::AppHandle, asset_id: String) -> Result<(), String> {
    remove_from_root(&app_data_dir(&app)?, &asset_id)
}

#[tauri::command]
pub fn restore_imported_bathymetry(
    app: tauri::AppHandle,
    asset_id: String,
) -> Result<ImportedBathymetryAsset, String> {
    restore_from_root(&app_data_dir(&app)?, &asset_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::bathymetry_import::BathymetrySampleSemantics;
    use geotiff_writer::GeoTiffBuilder;
    use ndarray::Array2;
    use tempfile::tempdir;

    fn fixture(directory: &Path) -> BathymetryPreflightRequest {
        let path = directory.join("depth.tif");
        let data = Array2::from_shape_vec((2, 2), vec![100.0_f32, 200.0, 300.0, 400.0]).unwrap();
        GeoTiffBuilder::new(2, 2)
            .epsg(4326)
            .vertical_epsg(5715)
            .vertical_datum(5100)
            .vertical_units(9001)
            .pixel_scale(1.0, 1.0)
            .origin(-2.0, 2.0)
            .write_2d(&path, data.view())
            .unwrap();
        BathymetryPreflightRequest {
            path: path.to_string_lossy().into_owned(),
            variable: None,
            source_label: "Cache fixture".into(),
            rights_statement: "User supplied; local educational use".into(),
            sample_semantics: BathymetrySampleSemantics::DepthPositiveDown,
        }
    }

    #[test]
    fn import_is_atomic_listable_and_recoverable() {
        let source = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let req = fixture(source.path());
        let preview = preflight_bathymetry_import(req.clone()).unwrap();
        let asset = import_into_root(app_data.path(), req, &preview.sha256).unwrap();
        let (_, raster) = load_cached_raster(app_data.path(), &asset.asset_id).unwrap();
        assert_eq!(raster.sample_bilinear(0.5, -1.5).unwrap(), 300.0);
        assert_eq!(raster.sample_bilinear(1.0, -1.0).unwrap(), 250.0);
        assert_eq!(
            list_from_root(&cache_root(app_data.path())).unwrap().len(),
            1
        );
        assert!(
            cache_root(app_data.path())
                .join(&asset.cache_file)
                .is_file()
        );

        remove_from_root(app_data.path(), &asset.asset_id).unwrap();
        assert!(
            list_from_root(&cache_root(app_data.path()))
                .unwrap()
                .is_empty()
        );
        assert!(trash_root(app_data.path()).join(&asset.asset_id).is_dir());

        let restored = restore_from_root(app_data.path(), &asset.asset_id).unwrap();
        assert_eq!(restored.report.sha256, preview.sha256);
        assert_eq!(
            list_from_root(&cache_root(app_data.path())).unwrap().len(),
            1
        );
    }

    #[test]
    fn import_rejects_a_stale_preview_digest() {
        let source = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let req = fixture(source.path());
        let error = import_into_root(app_data.path(), req, &"0".repeat(64)).unwrap_err();
        assert!(error.contains("changed after preview"));
        assert!(
            list_from_root(&cache_root(app_data.path()))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn list_rejects_a_missing_cached_source() {
        let source = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let req = fixture(source.path());
        let preview = preflight_bathymetry_import(req.clone()).unwrap();
        let asset = import_into_root(app_data.path(), req, &preview.sha256).unwrap();
        fs::remove_file(cache_root(app_data.path()).join(asset.cache_file)).unwrap();

        let error = list_from_root(&cache_root(app_data.path())).unwrap_err();
        assert!(error.contains("cached source is unavailable"));
    }

    #[test]
    fn solver_load_rejects_a_tampered_cached_source() {
        let source = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let req = fixture(source.path());
        let preview = preflight_bathymetry_import(req.clone()).unwrap();
        let asset = import_into_root(app_data.path(), req, &preview.sha256).unwrap();
        let cached = cache_root(app_data.path()).join(&asset.cache_file);
        let mut bytes = fs::read(&cached).unwrap();
        bytes[0] ^= 0xff;
        fs::write(cached, bytes).unwrap();

        let error = load_cached_raster(app_data.path(), &asset.asset_id).unwrap_err();
        assert!(error.contains("checksum"));
    }
}
