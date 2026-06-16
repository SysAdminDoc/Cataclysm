//! TsunamiSimulator backend.
//!
//! Physics lives in `physics::*`. Tauri command handlers are in `commands`.
//! Historical event registry lives in `presets`.

pub mod data;
pub mod physics;
pub mod presets;
pub mod commands;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            asteroid_initial_conditions,
            nuclear_initial_conditions,
            landslide_initial_conditions,
            earthquake_initial_conditions,
            far_field_amplitude,
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
            cancel_simulation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
