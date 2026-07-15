use std::collections::BTreeSet;

const BUILD_RS: &str = include_str!("../build.rs");
const LIB_RS: &str = include_str!("../src/lib.rs");
const APP_PERMISSIONS: &str = include_str!("../permissions/app-commands.toml");
const DEFAULT_CAPABILITY: &str = include_str!("../capabilities/default.json");

fn quoted_values(section: &str) -> BTreeSet<String> {
    section
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim().trim_end_matches(',');
            trimmed
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
                .map(ToOwned::to_owned)
        })
        .collect()
}

fn between<'a>(source: &'a str, start: &str, end: &str) -> &'a str {
    let (_, tail) = source
        .split_once(start)
        .unwrap_or_else(|| panic!("missing start marker: {start}"));
    tail.split_once(end)
        .unwrap_or_else(|| panic!("missing end marker: {end}"))
        .0
}

#[test]
fn registered_commands_match_manifest_and_permission_sets() {
    let registered = between(LIB_RS, "tauri::generate_handler![", "])")
        .lines()
        .filter_map(|line| {
            let command = line.trim().trim_end_matches(',');
            (!command.is_empty()).then(|| command.to_owned())
        })
        .collect::<BTreeSet<_>>();

    let manifested = quoted_values(between(BUILD_RS, ".commands(&[", "]);"));
    assert_eq!(
        registered, manifested,
        "every registered Tauri command must be declared in AppManifest"
    );

    let permitted = APP_PERMISSIONS
        .lines()
        .filter_map(|line| {
            let value = line.trim().trim_end_matches(',');
            value
                .strip_prefix("\"allow-")
                .and_then(|value| value.strip_suffix('"'))
                .map(|value| value.replace('-', "_"))
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(
        registered, permitted,
        "permission sets must grant each registered command exactly once"
    );
}

#[test]
fn custom_commands_are_granted_only_to_the_main_window() {
    assert!(
        DEFAULT_CAPABILITY.contains("\"windows\": [\"main\"]"),
        "the application-command capability must remain scoped to main"
    );
    assert!(
        !DEFAULT_CAPABILITY.contains("\"remote\""),
        "remote origins must not receive application-command permissions"
    );

    for permission_set in [
        "scientific-queries",
        "simulation-runs",
        "simulation-cancellation",
        "support-diagnostics",
        "cesium-credentials",
    ] {
        assert!(
            DEFAULT_CAPABILITY.contains(&format!("\"{permission_set}\"")),
            "main is missing the {permission_set} permission set"
        );
    }
}

#[test]
fn runtime_authority_denies_an_unprivileged_window() {
    use tauri::ipc::Origin;

    let mut context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let authority = context.runtime_authority_mut();
    for command in [
        "simulate_grid",
        "cancel_simulation",
        "diagnostics_bundle",
        "native_panic_record",
        "acknowledge_native_panic_record",
        "keychain_set_token",
    ] {
        assert!(
            authority
                .resolve_access(command, "main", "main", &Origin::Local)
                .is_some(),
            "main must retain access to {command}"
        );
        assert!(
            authority
                .resolve_access(command, "unprivileged", "unprivileged", &Origin::Local)
                .is_none(),
            "an unprivileged window must be denied {command}"
        );
    }
}
