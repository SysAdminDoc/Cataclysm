use std::path::{Path, PathBuf};

use serde_json::Value;
use tsunami_simulator_lib::{
    physics::direct_hazard::{AsteroidHazardRequest, NuclearHazardRequest},
    render_protocol::{asteroid_render_recording, nuclear_render_recording},
};

fn recording_bytes(packets: Vec<Vec<u8>>) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    for packet in packets {
        let length = u32::try_from(packet.len())
            .map_err(|_| "render packet exceeds the u32 recording limit".to_string())?;
        bytes.extend_from_slice(&length.to_le_bytes());
        bytes.extend_from_slice(&packet);
    }
    Ok(bytes)
}

fn main() -> Result<(), String> {
    let scenes_path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| {
            "usage: direct_render_fixtures <reference-scenes.json> <output-dir>".to_string()
        })?;
    let output_dir = std::env::args_os()
        .nth(2)
        .map(PathBuf::from)
        .ok_or_else(|| {
            "usage: direct_render_fixtures <reference-scenes.json> <output-dir>".to_string()
        })?;
    let document: Value = serde_json::from_slice(
        &std::fs::read(&scenes_path)
            .map_err(|error| format!("failed to read {}: {error}", scenes_path.display()))?,
    )
    .map_err(|error| format!("invalid {}: {error}", scenes_path.display()))?;
    let scenes = document["scenes"]
        .as_array()
        .ok_or_else(|| "reference scene contract has no scenes array".to_string())?;
    std::fs::create_dir_all(&output_dir)
        .map_err(|error| format!("failed to create {}: {error}", output_dir.display()))?;

    for scene in scenes {
        let id = scene["id"]
            .as_str()
            .ok_or_else(|| "reference scene has no id".to_string())?;
        let workflow = &scene["workflow"];
        let kind = workflow["kind"].as_str().unwrap_or_default();
        let packets = match kind {
            "direct-asteroid" => {
                let request: AsteroidHazardRequest =
                    serde_json::from_value(workflow["request"].clone())
                        .map_err(|error| format!("invalid asteroid request for {id}: {error}"))?;
                asteroid_render_recording(&request)?.1
            }
            "direct-nuclear" => {
                let request: NuclearHazardRequest =
                    serde_json::from_value(workflow["request"].clone())
                        .map_err(|error| format!("invalid nuclear request for {id}: {error}"))?;
                nuclear_render_recording(&request)?.1
            }
            _ => continue,
        };
        let output = Path::new(&output_dir).join(format!("{id}.catframe"));
        std::fs::write(&output, recording_bytes(packets)?)
            .map_err(|error| format!("failed to write {}: {error}", output.display()))?;
    }
    Ok(())
}
