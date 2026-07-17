use super::*;

/// Lightweight GPU-availability probe. The frontend mirrors this bounded
/// vocabulary without importing the backend enum.
#[tauri::command]
pub fn gpu_probe() -> String {
    #[cfg(feature = "gpu")]
    {
        use crate::physics::solver::gpu::{GpuAvailability, probe_adapter};
        match probe_adapter() {
            GpuAvailability::Available => "available".to_string(),
            GpuAvailability::NoAdapter | GpuAvailability::AdapterFailed(_) => {
                "no-adapter".to_string()
            }
        }
    }
    #[cfg(not(feature = "gpu"))]
    {
        "feature-off".to_string()
    }
}

const KEYCHAIN_SERVICE: &str = "TsunamiSimulator";
const KEYCHAIN_USER: &str = "cesium_ion_token";

fn keychain_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .map_err(|e| format!("keychain unavailable: {e}"))
}

#[tauri::command]
pub fn keychain_get_token() -> Result<Option<String>, String> {
    match keychain_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain read failed: {e}")),
    }
}

#[tauri::command]
pub fn keychain_set_token(token: String) -> Result<(), String> {
    if token.len() > 4096 {
        return Err("token too long".into());
    }
    let entry = keychain_entry()?;
    if token.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keychain delete failed: {e}")),
        }
    } else {
        entry
            .set_password(&token)
            .map_err(|e| format!("keychain write failed: {e}"))
    }
}

/// Support-ready, PII-free diagnostics for the LogViewer copy action.
#[derive(Debug, Serialize)]
pub struct DiagnosticsBundle {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub gpu_status: String,
    pub gpu_adapter: Option<String>,
    pub solver: String,
    pub geodesy: crate::data::geodesy::GeodesyDiagnostics,
    pub surface_mask: crate::data::surface::SurfaceMaskDiagnostics,
    pub last_run_quality: Option<RunQualityRecord>,
    pub active_solver_runs: u32,
    pub solver_reserved_memory_bytes: u64,
    pub solver_memory_budget_bytes: u64,
}

#[tauri::command]
pub fn diagnostics_bundle() -> DiagnosticsBundle {
    let (active_solver_runs, solver_reserved_memory_bytes) = simulation_resource_status();
    #[cfg(feature = "gpu")]
    let (gpu_status, gpu_adapter) = {
        use crate::physics::solver::gpu::{GpuAvailability, adapter_summary, probe_adapter};
        match probe_adapter() {
            GpuAvailability::Available => ("available".to_string(), adapter_summary()),
            GpuAvailability::NoAdapter | GpuAvailability::AdapterFailed(_) => {
                ("no-adapter".to_string(), None)
            }
        }
    };
    #[cfg(not(feature = "gpu"))]
    let (gpu_status, gpu_adapter) = ("feature-off".to_string(), None);

    DiagnosticsBundle {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        solver: if gpu_status == "available" {
            "GPU (wgpu) with CPU fallback".to_string()
        } else {
            "CPU (rayon)".to_string()
        },
        gpu_status,
        gpu_adapter,
        geodesy: crate::data::geodesy::diagnostics(),
        surface_mask: crate::data::surface::diagnostics(),
        last_run_quality: LAST_RUN_QUALITY
            .lock()
            .ok()
            .and_then(|quality| quality.clone()),
        active_solver_runs,
        solver_reserved_memory_bytes,
        solver_memory_budget_bytes: SWE_MEMORY_BUDGET_BYTES,
    }
}

#[tauri::command]
pub fn cancel_simulation(run_id: String) -> Result<bool, String> {
    validate_run_id(&run_id)?;
    if let Ok(mut guard) = ACTIVE_SIMULATIONS.lock() {
        guard.retain(|_, run| run.cancel.strong_count() > 0);
        if let Some(token) = guard.get(&run_id).and_then(|run| run.cancel.upgrade()) {
            token.store(true, Ordering::Release);
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn list_solver_checkpoints(
    app: AppHandle,
) -> Result<Vec<crate::physics::solver::checkpoint::CheckpointSummary>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("application data directory is unavailable: {error}"))?;
    crate::physics::solver::checkpoint::list(&root)
}

#[tauri::command]
pub fn remove_solver_checkpoint(app: AppHandle, run_id: String) -> Result<bool, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("application data directory is unavailable: {error}"))?;
    crate::physics::solver::checkpoint::remove(&root, &run_id)
}

#[tauri::command]
pub fn render_protocol_capabilities() -> crate::render_protocol::ProtocolCapabilitiesV1 {
    crate::render_protocol::capabilities()
}
