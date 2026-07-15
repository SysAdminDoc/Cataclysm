//! Cataclysm backend.
//!
//! Physics lives in `physics::*`. Tauri command handlers are in `commands`.
//! Historical event registry lives in `presets`.

pub mod commands;
pub mod data;
pub mod native_diagnostics;
pub mod physics;
pub mod presets;
pub mod render_protocol;
pub mod support_resources;

use commands::*;
use native_diagnostics::{
    NativeDiagnosticsState, acknowledge_native_panic_record, install_native_panic_hook,
    native_panic_record,
};
use std::path::PathBuf;
use support_resources::third_party_notices;
use tauri::Manager;

fn native_diagnostics_directory(app: &tauri::App) -> Result<PathBuf, String> {
    if std::env::var("CATACLYSM_INSTALL_SMOKE_ISOLATED").as_deref() == Ok("1")
        && std::env::var("CATACLYSM_NATIVE_PANIC_FIXTURE").as_deref() == Ok("1")
        && let Some(path) = std::env::var_os("CATACLYSM_NATIVE_DIAGNOSTICS_DIR")
    {
        return Ok(PathBuf::from(path));
    }
    app.path()
        .app_log_dir()
        .map_err(|error| format!("failed to resolve application log directory: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let state = match native_diagnostics_directory(app) {
                Ok(directory) => match install_native_panic_hook(directory.clone()) {
                    Ok(()) => NativeDiagnosticsState::new(directory),
                    Err(error) => {
                        eprintln!("Cataclysm native panic persistence is unavailable: {error}");
                        NativeDiagnosticsState::disabled()
                    }
                },
                Err(error) => {
                    eprintln!("Cataclysm native panic persistence is unavailable: {error}");
                    NativeDiagnosticsState::disabled()
                }
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            asteroid_initial_conditions,
            nuclear_initial_conditions,
            landslide_initial_conditions,
            earthquake_initial_conditions,
            far_field_amplitude,
            attenuation_curve,
            coastal_runup,
            runup_at_points,
            list_presets,
            run_preset,
            simulate_grid,
            simulate_grid_streaming,
            inspect_at_point,
            lamb_wave_sample,
            dart_buoy_rmse,
            gpu_probe,
            render_protocol_capabilities,
            surface_probe,
            simulate_asteroid_hazard,
            simulate_asteroid_hazard_render,
            simulate_nuclear_hazard,
            simulate_nuclear_hazard_render,
            diagnostics_bundle,
            native_panic_record,
            acknowledge_native_panic_record,
            third_party_notices,
            keychain_get_token,
            keychain_set_token,
            cancel_simulation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
