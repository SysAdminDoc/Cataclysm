fn main() {
    // Keep this list in lockstep with `tauri::generate_handler!` in `src/lib.rs`.
    // Declaring application commands here opts custom IPC into Tauri's runtime
    // authority instead of exposing every registered command to every webview.
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "asteroid_initial_conditions",
        "nuclear_initial_conditions",
        "landslide_initial_conditions",
        "earthquake_initial_conditions",
        "far_field_amplitude",
        "attenuation_curve",
        "coastal_runup",
        "runup_at_points",
        "list_presets",
        "run_preset",
        "simulate_grid",
        "simulate_grid_streaming",
        "inspect_at_point",
        "lamb_wave_sample",
        "dart_buoy_rmse",
        "gpu_probe",
        "render_protocol_capabilities",
        "surface_probe",
        "simulate_asteroid_hazard",
        "simulate_asteroid_hazard_render",
        "simulate_nuclear_hazard",
        "simulate_nuclear_hazard_render",
        "diagnostics_bundle",
        "native_panic_record",
        "acknowledge_native_panic_record",
        "keychain_get_token",
        "keychain_set_token",
        "cancel_simulation",
    ]);

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to build Cataclysm with its custom-command ACL")
}
