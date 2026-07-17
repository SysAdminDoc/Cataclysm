use std::fs;
use std::path::Path;
use tauri::Manager;

const THIRD_PARTY_NOTICES_FILE: &str = "THIRD_PARTY_NOTICES.txt";
const THIRD_PARTY_NOTICES_HEADER: &str = "CATACLYSM THIRD-PARTY NOTICES";
const MAX_THIRD_PARTY_NOTICES_BYTES: u64 = 8 * 1024 * 1024;

fn read_third_party_notices(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("bundled third-party notices are unavailable: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_THIRD_PARTY_NOTICES_BYTES
    {
        return Err("bundled third-party notices have an invalid size".into());
    }

    let notices = fs::read_to_string(path)
        .map_err(|error| format!("bundled third-party notices could not be read: {error}"))?;
    if !notices.starts_with(THIRD_PARTY_NOTICES_HEADER) {
        return Err("bundled third-party notices have an invalid header".into());
    }
    Ok(notices)
}

#[tauri::command]
pub fn third_party_notices(app: tauri::AppHandle) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve bundled resources: {error}"))?;
    read_third_party_notices(&resource_dir.join(THIRD_PARTY_NOTICES_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracked_notice_artifact_is_readable_and_bounded() {
        let artifact = Path::new(env!("CARGO_MANIFEST_DIR")).join("../THIRD_PARTY_NOTICES.txt");
        let notices = read_third_party_notices(&artifact).expect("tracked notices must be valid");
        let summary = notices
            .lines()
            .find(|line| line.starts_with("Production components: "))
            .expect("tracked notices must report production component counts");
        let counts = summary
            .strip_prefix("Production components: ")
            .expect("summary prefix was checked")
            .split_once(" npm; ")
            .expect("summary must separate npm and Rust counts");
        let npm_count = counts
            .0
            .parse::<usize>()
            .expect("npm count must be numeric");
        let rust_count = counts
            .1
            .strip_suffix(" Rust")
            .expect("summary must label Rust dependencies")
            .parse::<usize>()
            .expect("Rust count must be numeric");
        assert!(npm_count > 0 && rust_count > 0);
        assert!(notices.len() < MAX_THIRD_PARTY_NOTICES_BYTES as usize);
    }
}
