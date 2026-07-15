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

fn native_panic_fixture_path(
    mut args: impl Iterator<Item = OsString>,
    enabled: bool,
) -> Result<Option<PathBuf>, String> {
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--native-panic-fixture")) {
        return Ok(None);
    }
    if !enabled {
        return Err(
            "--native-panic-fixture is restricted to the isolated installed-smoke host".into(),
        );
    }
    let directory = args
        .next()
        .map(PathBuf::from)
        .ok_or_else(|| "--native-panic-fixture requires an output directory".to_owned())?;
    if args.next().is_some() {
        return Err("--native-panic-fixture accepts exactly one output directory".to_owned());
    }
    Ok(Some(directory))
}

fn run_native_panic_fixture_if_requested() -> Result<bool, String> {
    let enabled = env::var("CATACLYSM_INSTALL_SMOKE_ISOLATED").as_deref() == Ok("1")
        && env::var("CATACLYSM_NATIVE_PANIC_FIXTURE").as_deref() == Ok("1");
    let Some(directory) = native_panic_fixture_path(env::args_os().skip(1), enabled)? else {
        return Ok(false);
    };
    tsunami_simulator_lib::native_diagnostics::install_native_panic_hook(directory)
        .map_err(|error| format!("failed to install native panic fixture hook: {error}"))?;
    panic!(
        "native panic fixture scenario request contained access_token=not-a-real-secret at C:\\private\\scenario.json"
    );
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
    match run_native_panic_fixture_if_requested() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("Cataclysm native panic fixture failed: {error}");
            process::exit(2);
        }
    }
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
    use super::{native_panic_fixture_path, release_probe_path};
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

    #[test]
    fn native_panic_fixture_is_gated_and_requires_one_directory() {
        assert_eq!(
            native_panic_fixture_path(args(&["--some-flag"]), false).unwrap(),
            None
        );
        assert!(
            native_panic_fixture_path(args(&["--native-panic-fixture", "out"]), false).is_err()
        );
        assert_eq!(
            native_panic_fixture_path(args(&["--native-panic-fixture", "out"]), true).unwrap(),
            Some(PathBuf::from("out"))
        );
        assert!(native_panic_fixture_path(args(&["--native-panic-fixture"]), true).is_err());
        assert!(
            native_panic_fixture_path(args(&["--native-panic-fixture", "one", "two"]), true)
                .is_err()
        );
    }
}
