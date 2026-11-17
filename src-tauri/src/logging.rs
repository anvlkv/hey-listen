//! Application logging (ADR-33): one sink for both producers.
//!
//! `tauri-plugin-log` is the only writer. This module owns the plugin's configuration
//! (`targets` / `level`), the log file's location (`log_dir` / `log_file` — the same
//! answer the frontend's `log_path` command reports), panic reporting, and the tail the
//! preview window reads. See `docs/logging.md` for the design.
//!
//! Two env vars make the destination and the volume adjustable without a rebuild:
//! `HEYLISTEN_LOG_DIR` relocates the file target (the E2E hook), and
//! `HEYLISTEN_LOG_LEVEL` overrides the filter.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// The log file's stem: the plugin writes `<stem>.<extension>`.
pub const FILE_STEM: &str = "hey-listen";

/// Env var that **relocates** the log file (`TargetKind::Folder` instead of the OS log
/// directory). The E2E suite sets it so a CI artifact carries the app's own log.
pub const DIR_ENV: &str = "HEYLISTEN_LOG_DIR";

/// Env var that overrides the level filter (`trace` … `error`, default `info`), so a bug
/// report can be taken at `debug` without a rebuild.
pub const LEVEL_ENV: &str = "HEYLISTEN_LOG_LEVEL";

/// The extension the plugin appends to [`FILE_STEM`].
const FILE_EXTENSION: &str = "log";

/// How much of the file's end the preview reads on one poll.
const TAIL_BYTES: u64 = 256 * 1024;

/// The most lines one poll returns (the preview's list, not the file).
const TAIL_LINES: usize = 500;

#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error("could not access the log: {0}")]
    Io(#[from] std::io::Error),
    #[error("no log directory is available")]
    NoLogDir,
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(LogError);

/// The active log destination: the directory and the file inside it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LogPath {
    pub dir: String,
    pub file: String,
}

/// The end of the log file, for the preview window.
#[derive(Debug, Clone, Default, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LogTail {
    pub lines: Vec<String>,
    /// The file is longer than one poll reads, so `lines` is its **end**.
    pub truncated: bool,
}

/// The plugin's targets for this entry.
///
/// The GUI keeps one **file** for both producers (a backend line and a frontend line
/// land in the same file; the target in the line says which side wrote it), stderr, and
/// the webview target that mirrors records into a dev webview console. The **CLI**
/// entries (`--mcp`, `--headless`) log to **stderr only**: a sandboxed or concurrent
/// headless/CI run must not abort because the log directory is unwritable or another
/// instance holds the file. The batch CLI is a separate console binary with no log
/// plugin at all (ADR-29).
pub fn targets(cli_invocation: bool) -> Vec<tauri_plugin_log::Target> {
    use tauri_plugin_log::{Target, TargetKind};
    let stderr = Target::new(TargetKind::Stderr);
    if cli_invocation {
        return vec![stderr];
    }
    let file = match dir_from_env() {
        Some(path) => Target::new(TargetKind::Folder {
            path,
            file_name: Some(FILE_STEM.to_string()),
        }),
        None => Target::new(TargetKind::LogDir {
            file_name: Some(FILE_STEM.to_string()),
        }),
    };
    // The webview target is what makes the frontend's records reach the file **and** the
    // devtools mirror; without it the frontend forwarding has nowhere to go.
    vec![stderr, file, Target::new(TargetKind::Webview)]
}

/// The level filter to apply (the plugin's global maximum).
pub fn level() -> log::LevelFilter {
    level_from_env(std::env::var(LEVEL_ENV).ok().as_deref())
}

/// The log directory: `HEYLISTEN_LOG_DIR` when it is set, else the OS log directory.
pub fn log_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, LogError> {
    if let Some(path) = dir_from_env() {
        return Ok(path);
    }
    app.path().app_log_dir().map_err(|_| LogError::NoLogDir)
}

/// The log file: [`log_dir`] plus the plugin's file name.
pub fn log_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, LogError> {
    Ok(log_dir(app)?.join(format!("{FILE_STEM}.{FILE_EXTENSION}")))
}

/// The active destination as strings, for the frontend.
pub fn log_path<R: Runtime>(app: &AppHandle<R>) -> Result<LogPath, LogError> {
    Ok(LogPath {
        dir: log_dir(app)?.to_string_lossy().into_owned(),
        file: log_file(app)?.to_string_lossy().into_owned(),
    })
}

/// The end of the log file. A file that does not exist yet (a fresh launch) is empty,
/// not an error — the first record creates it.
pub fn read_tail<R: Runtime>(app: &AppHandle<R>) -> Result<LogTail, LogError> {
    match tail_of(&log_file(app)?, TAIL_BYTES, TAIL_LINES) {
        Ok(tail) => Ok(tail),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(LogTail::default()),
        Err(err) => Err(err.into()),
    }
}

/// Reveal the log directory in the OS file manager (creating it first).
pub fn open_dir<R: Runtime>(app: &AppHandle<R>) -> Result<(), LogError> {
    let dir = log_dir(app)?;
    std::fs::create_dir_all(&dir)?;
    open_in_file_manager(&dir);
    Ok(())
}

/// Report a Rust **panic** to the log before the process aborts.
///
/// A release build aborts (`panic = "abort"`), so the default report reaches stderr only
/// and the file a bug report carries would miss the one line that explains the crash. The
/// previous hook still runs, so stderr keeps its standard, symbolized report. A CLI entry
/// already prints to stderr and has no file target, so only a GUI launch installs this.
pub fn guard_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info
            .location()
            .map(|location| format!(" at {}:{}", location.file(), location.line()))
            .unwrap_or_default();
        log::error!("panic{at}: {info}");
        previous(info);
    }));
}

/// Open a directory in the platform's file manager.
///
/// One copy for every "reveal in the file manager" action (the themes store, the log
/// directory): the platform program is named once.
pub(crate) fn open_in_file_manager(dir: &Path) {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    if let Err(err) = std::process::Command::new(program).arg(dir).spawn() {
        log::warn!("could not open {}: {err}", dir.display());
    }
}

/// `HEYLISTEN_LOG_DIR`, when it names a directory.
fn dir_from_env() -> Option<PathBuf> {
    parse_dir(std::env::var(DIR_ENV).ok().as_deref())
}

/// An env value as a destination. Blank means "not set" (a launcher often exports an
/// empty variable), so it can never send the log to the process's current directory.
fn parse_dir(raw: Option<&str>) -> Option<PathBuf> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// An env value as a level filter; an unknown or absent value is `info`.
fn level_from_env(raw: Option<&str>) -> log::LevelFilter {
    raw.map(str::trim)
        .and_then(|value| value.parse::<log::LevelFilter>().ok())
        .unwrap_or(log::LevelFilter::Info)
}

/// Read at most `max_bytes` from the end of `path`, keeping at most `max_lines` of them.
///
/// The file is capped before it rotates, so one poll stays cheap. A read that starts
/// mid-file begins mid-record: its partial first line is dropped (`truncated` says so),
/// and the next poll re-reads the whole tail.
fn tail_of(path: &Path, max_bytes: u64, max_lines: usize) -> std::io::Result<LogTail> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let skip = len.saturating_sub(max_bytes);
    if skip > 0 {
        file.seek(SeekFrom::Start(skip))?;
    }
    let mut bytes = Vec::new();
    (&mut file).take(len - skip).read_to_end(&mut bytes)?;

    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let mut truncated = skip > 0;
    if truncated && !lines.is_empty() {
        lines.remove(0);
    }
    if lines.len() > max_lines {
        lines.drain(..lines.len() - max_lines);
        truncated = true;
    }
    Ok(LogTail { lines, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cli_entry_logs_to_stderr_only() {
        assert_eq!(targets(true).len(), 1);
    }

    #[test]
    fn the_gui_keeps_its_file_and_the_webview_target() {
        // stderr + the file + the webview mirror.
        assert_eq!(targets(false).len(), 3);
    }

    #[test]
    fn the_dir_env_moves_the_file_and_a_blank_value_means_unset() {
        assert_eq!(
            parse_dir(Some("/tmp/heyl-logs")),
            Some(PathBuf::from("/tmp/heyl-logs"))
        );
        assert_eq!(
            parse_dir(Some("  /tmp/heyl-logs ")),
            Some(PathBuf::from("/tmp/heyl-logs"))
        );
        assert_eq!(parse_dir(Some("")), None);
        assert_eq!(parse_dir(Some("   ")), None);
        assert_eq!(parse_dir(None), None);
    }

    #[test]
    fn an_unknown_level_falls_back_to_info() {
        assert_eq!(level_from_env(Some("debug")), log::LevelFilter::Debug);
        assert_eq!(level_from_env(Some(" ERROR ")), log::LevelFilter::Error);
        assert_eq!(level_from_env(Some("loud")), log::LevelFilter::Info);
        assert_eq!(level_from_env(None), log::LevelFilter::Info);
    }

    #[test]
    fn the_tail_is_byte_capped_and_starts_on_a_whole_line() {
        let dir = std::env::temp_dir().join(format!("heyl-log-tail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("hey-listen.log");
        std::fs::write(&path, "first line\nsecond line\nthird line\n").expect("write");

        // A cap smaller than the file keeps its end, minus the partial leading record.
        let tail = tail_of(&path, 18, 10).expect("tail");
        assert!(tail.truncated);
        assert_eq!(tail.lines, vec!["third line".to_string()]);

        // A cap that covers the file returns all of it.
        let whole = tail_of(&path, 1024, 10).expect("whole");
        assert!(!whole.truncated);
        assert_eq!(whole.lines.len(), 3);

        // The line cap keeps the newest lines.
        let newest = tail_of(&path, 1024, 1).expect("newest");
        assert!(newest.truncated);
        assert_eq!(newest.lines, vec!["third line".to_string()]);

        std::fs::remove_dir_all(&dir).expect("clean up");
    }
}
