//! Bounded native panic evidence for the existing local crash-recovery flow.
//!
//! The panic hook deliberately stores less information than Rust's default
//! stderr report: no backtrace, environment, scenario/request payload, URL, or
//! absolute source path. The previous hook is still chained so Rust preserves
//! its normal failure reporting and exit behaviour.

use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Write,
    panic::{self, PanicHookInfo},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const SCHEMA_VERSION: u32 = 1;
const RECORD_PREFIX: &str = "record-";
const MAX_RECORD_BYTES: u64 = 4 * 1024;
const MAX_MESSAGE_CHARS: usize = 512;
static HOOK_INSTALLED: OnceLock<()> = OnceLock::new();
static RECORD_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativePanicLocation {
    pub file: String,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativePanicRecord {
    pub schema_version: u32,
    pub id: String,
    pub app_version: String,
    pub timestamp_ms: u64,
    pub message: String,
    pub location: Option<NativePanicLocation>,
}

#[derive(Debug)]
pub struct NativeDiagnosticsState {
    directory: Option<PathBuf>,
}

impl NativeDiagnosticsState {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory: Some(directory),
        }
    }

    pub fn disabled() -> Self {
        Self { directory: None }
    }

    fn directory(&self) -> Option<&Path> {
        self.directory.as_deref()
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn safe_record_id(value: &str) -> bool {
    value.starts_with(RECORD_PREFIX)
        && value.len() <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn contains_sensitive_context(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "scenario",
        "request",
        "input",
        "environment",
        "access_token",
        "api_key",
        "apikey",
        "authorization",
        "bearer ",
        "password",
        "secret",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn token_is_path_or_url(token: &str) -> bool {
    token.contains("\\\\")
        || token.contains('\\')
        || token.contains("://")
        || token.starts_with('/')
        || (token.len() > 2
            && token.as_bytes()[1] == b':'
            && token.as_bytes()[0].is_ascii_alphabetic())
}

fn token_is_opaque_secret(token: &str) -> bool {
    token.len() >= 32
        && token.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'+' | b'/' | b'=')
        })
        && token.bytes().any(|byte| byte.is_ascii_alphabetic())
        && token.bytes().any(|byte| byte.is_ascii_digit())
}

fn redact_message(raw: &str) -> String {
    if raw.is_empty() {
        return "native panic (message unavailable)".into();
    }
    if contains_sensitive_context(raw)
        || raw
            .chars()
            .any(|character| matches!(character, '{' | '}' | '[' | ']'))
    {
        return "native panic ([redacted-message])".into();
    }
    let mut output = Vec::new();
    for token in raw.split_whitespace().take(64) {
        let sanitized = if token_is_path_or_url(token) {
            "[redacted-path]"
        } else if token_is_opaque_secret(token) {
            "[redacted-value]"
        } else {
            token
        };
        output.push(sanitized);
    }
    let mut message = output.join(" ");
    if message.chars().count() > MAX_MESSAGE_CHARS {
        message = message.chars().take(MAX_MESSAGE_CHARS).collect();
        message.push('…');
    }
    message
}

fn safe_location(info: &PanicHookInfo<'_>) -> Option<NativePanicLocation> {
    let location = info.location()?;
    let file = Path::new(location.file())
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)?
        .to_owned();
    Some(NativePanicLocation {
        file,
        line: location.line(),
        column: location.column(),
    })
}

fn panic_message(info: &PanicHookInfo<'_>) -> String {
    let raw = info
        .payload()
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
        .unwrap_or("native panic (non-string payload)");
    redact_message(raw)
}

fn record_file(directory: &Path, id: &str) -> PathBuf {
    directory.join(format!("{id}.json"))
}

fn active_record_files(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut records = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension() == Some(OsStr::new("json"))
                && path
                    .file_stem()
                    .and_then(OsStr::to_str)
                    .is_some_and(safe_record_id)
        })
        .collect::<Vec<_>>();
    records.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    records
}

fn quarantine(path: &Path) {
    let quarantine_path = path.with_extension(format!("quarantine-{}", timestamp_ms()));
    let _ = fs::rename(path, quarantine_path);
}

fn validate_record(record: &NativePanicRecord, expected_id: &str) -> bool {
    record.schema_version == SCHEMA_VERSION
        && record.id == expected_id
        && safe_record_id(&record.id)
        && !record.app_version.is_empty()
        && record.app_version.len() <= 64
        && record.timestamp_ms > 0
        && !record.message.is_empty()
        && record.message.chars().count() <= MAX_MESSAGE_CHARS + 1
        && record.location.as_ref().is_none_or(|location| {
            !location.file.is_empty()
                && location.file.len() <= 128
                && !location
                    .file
                    .chars()
                    .any(|character| matches!(character, '/' | '\\'))
        })
}

fn read_record(path: &Path) -> Option<NativePanicRecord> {
    let expected_id = path.file_stem()?.to_str()?;
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() == 0 || metadata.len() > MAX_RECORD_BYTES {
        quarantine(path);
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let Ok(record) = serde_json::from_slice::<NativePanicRecord>(&bytes) else {
        quarantine(path);
        return None;
    };
    if !validate_record(&record, expected_id) {
        quarantine(path);
        return None;
    }
    Some(record)
}

fn write_record(directory: &Path, mut record: NativePanicRecord) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let mut sequence = 0_u16;
    loop {
        let id = format!(
            "{RECORD_PREFIX}{}-{}-{sequence}",
            record.timestamp_ms,
            std::process::id()
        );
        let final_path = record_file(directory, &id);
        if !final_path.exists() {
            record.id = id;
            let body = serde_json::to_vec(&record)?;
            if body.len() as u64 > MAX_RECORD_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "native panic record exceeds its size limit",
                ));
            }
            let temp_path = final_path.with_extension("tmp");
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            file.write_all(&body)?;
            file.sync_all()?;
            fs::rename(&temp_path, &final_path)?;
            for stale in active_record_files(directory) {
                if stale != final_path {
                    let _ = fs::remove_file(stale);
                }
            }
            return Ok(());
        }
        sequence = sequence.checked_add(1).ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "record id space exhausted",
            )
        })?;
    }
}

fn persist_panic(directory: &Path, info: &PanicHookInfo<'_>) {
    // Multiple worker threads can panic while unwinding a shared failure. Keep
    // write-and-prune atomic as a group so concurrent hooks cannot delete each
    // other's final record and leave no recovery evidence.
    let _write_guard = RECORD_WRITE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let record = NativePanicRecord {
        schema_version: SCHEMA_VERSION,
        id: String::new(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        timestamp_ms: timestamp_ms(),
        message: panic_message(info),
        location: safe_location(info),
    };
    let _ = write_record(directory, record);
}

pub fn install_native_panic_hook(directory: PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(&directory)?;
    if HOOK_INSTALLED.set(()).is_err() {
        return Ok(());
    }
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        persist_panic(&directory, info);
        previous(info);
    }));
    Ok(())
}

#[tauri::command]
pub fn native_panic_record(
    state: State<'_, NativeDiagnosticsState>,
) -> Result<Option<NativePanicRecord>, String> {
    let Some(directory) = state.directory() else {
        return Ok(None);
    };
    for path in active_record_files(directory) {
        if let Some(record) = read_record(&path) {
            return Ok(Some(record));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn acknowledge_native_panic_record(
    record_id: String,
    state: State<'_, NativeDiagnosticsState>,
) -> Result<(), String> {
    if !safe_record_id(&record_id) {
        return Err("invalid native panic record id".into());
    }
    let Some(directory) = state.directory() else {
        return Ok(());
    };
    let path = record_file(directory, &record_id);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("failed to acknowledge panic record: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_directory(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "cataclysm-native-diagnostics-{name}-{}-{}",
            std::process::id(),
            timestamp_ms()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn redaction_excludes_paths_tokens_scenarios_and_opaque_values() {
        assert_eq!(
            redact_message("failed at C:\\Users\\private\\scenario.json"),
            "native panic ([redacted-message])"
        );
        assert_eq!(
            redact_message("access_token=not-a-real-secret"),
            "native panic ([redacted-message])"
        );
        assert_eq!(
            redact_message("digest abcdefghijklmnopqrstuvwxyz1234567890"),
            "digest [redacted-value]"
        );
        assert_eq!(
            redact_message("assertion failed: left == right"),
            "assertion failed: left == right"
        );
    }

    #[test]
    fn atomic_record_write_is_bounded_and_keeps_only_the_newest_record() {
        let directory = temp_directory("atomic");
        for timestamp in [10_u64, 20] {
            write_record(
                &directory,
                NativePanicRecord {
                    schema_version: SCHEMA_VERSION,
                    id: String::new(),
                    app_version: "1.2.3".into(),
                    timestamp_ms: timestamp,
                    message: "fixture panic".into(),
                    location: Some(NativePanicLocation {
                        file: "fixture.rs".into(),
                        line: 12,
                        column: 4,
                    }),
                },
            )
            .unwrap();
        }
        let files = active_record_files(&directory);
        assert_eq!(files.len(), 1);
        assert!(fs::metadata(&files[0]).unwrap().len() <= MAX_RECORD_BYTES);
        let record = read_record(&files[0]).unwrap();
        assert_eq!(record.timestamp_ms, 20);
        assert_eq!(record.location.unwrap().file, "fixture.rs");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn malformed_and_future_records_are_quarantined() {
        let directory = temp_directory("quarantine");
        let malformed = directory.join("record-1-1-0.json");
        fs::write(&malformed, b"not json").unwrap();
        assert!(read_record(&malformed).is_none());
        assert!(!malformed.exists());

        let future = directory.join("record-2-1-0.json");
        fs::write(
            &future,
            br#"{"schema_version":2,"id":"record-2-1-0","app_version":"1","timestamp_ms":2,"message":"future","location":null}"#,
        )
        .unwrap();
        assert!(read_record(&future).is_none());
        assert!(!future.exists());
        assert_eq!(
            fs::read_dir(&directory)
                .unwrap()
                .flatten()
                .filter(|entry| entry
                    .path()
                    .extension()
                    .is_some_and(|ext| { ext.to_string_lossy().starts_with("quarantine-") }))
                .count(),
            2
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
