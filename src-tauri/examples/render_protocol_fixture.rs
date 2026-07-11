use std::path::PathBuf;

fn main() -> Result<(), String> {
    let output = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| "usage: render_protocol_fixture <output.catframe>".to_string())?;
    let bytes = tsunami_simulator_lib::render_protocol::golden_recording_bytes()?;
    std::fs::write(&output, bytes)
        .map_err(|error| format!("failed to write {}: {error}", output.display()))?;
    Ok(())
}
