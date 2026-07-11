// Prevent additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::json;
use std::{env, ffi::OsString, fs, path::PathBuf, process};

fn release_probe_path(mut args: impl Iterator<Item = OsString>) -> Result<Option<PathBuf>, String> {
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--release-probe")) {
        return Ok(None);
    }
    let output = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "--release-probe requires an output path".to_owned())?;
    if args.next().is_some() {
        return Err("--release-probe accepts exactly one output path".to_owned());
    }
    Ok(Some(output))
}

fn write_release_probe_if_requested() -> Result<bool, String> {
    let Some(output) = release_probe_path(env::args_os().skip(1))? else {
        return Ok(false);
    };
    let gpu_status = tsunami_simulator_lib::commands::gpu_probe();
    let payload = json!({
        "version": env!("CARGO_PKG_VERSION"),
        "gpu_feature": cfg!(feature = "gpu"),
        "validation_feature": cfg!(feature = "validation"),
        "gpu_status": gpu_status,
    });
    fs::write(&output, format!("{payload:#}\n"))
        .map_err(|error| format!("failed to write {}: {error}", output.display()))?;
    Ok(true)
}

fn main() {
    match write_release_probe_if_requested() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("Cataclysm release probe failed: {error}");
            process::exit(2);
        }
    }
    tsunami_simulator_lib::run();
}

#[cfg(test)]
mod tests {
    use super::release_probe_path;
    use std::{ffi::OsString, path::PathBuf};

    fn args(values: &[&str]) -> impl Iterator<Item = OsString> {
        values
            .iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn ignores_normal_desktop_arguments() {
        assert_eq!(release_probe_path(args(&[])).unwrap(), None);
        assert_eq!(release_probe_path(args(&["--some-flag"])).unwrap(), None);
    }

    #[test]
    fn accepts_exactly_one_probe_path() {
        assert_eq!(
            release_probe_path(args(&["--release-probe", "capabilities.json"])).unwrap(),
            Some(PathBuf::from("capabilities.json"))
        );
        assert!(release_probe_path(args(&["--release-probe"])).is_err());
        assert!(release_probe_path(args(&["--release-probe", "one", "two"])).is_err());
    }
}
