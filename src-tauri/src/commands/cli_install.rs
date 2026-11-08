//! CLI-follows-app (M33.C, ADR-30): the bundled `hey-listen-cli` console binary,
//! installed to a per-user location and kept in step with the running app.
//!
//! [`install`] copies the sidecar next to the tool's name and records the app version it
//! came from (`hey-listen-cli.version`); [`refresh_if_stale`] re-copies only when that
//! recorded version differs, which is what [`refresh_on_startup`] runs after an update —
//! so updating the app updates the installed CLI. The copy is staged and renamed into
//! place, so a failure leaves any existing install untouched.
//!
//! The menu surface that installs / repairs / removes it is M33.D (ADR-31); this module
//! exposes the logic, the [`cli_tool_status`] / [`cli_tool_install`] / [`cli_tool_uninstall`]
//! commands it will call, and the startup refresh. See `docs/updater.md`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// The bundled console binary's name, as `bundle.externalBin` spells it.
pub const BINARY_NAME: &str = "hey-listen-cli";

/// The app version an installed CLI is pinned to — the crate and the app share one.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, thiserror::Error)]
pub enum CliInstallError {
    #[error("could not install the command-line tool: {0}")]
    Io(#[from] std::io::Error),
    #[error("the bundled command-line tool was not found (looked at {0})")]
    SidecarMissing(String),
    #[error("no per-user bin directory is available for this account")]
    NoTargetDir,
}

// `tauri` command errors must be `Serialize`; surface the human-readable message.
serialize_error_as_string!(CliInstallError);

/// An installed (or installable) `hey-listen-cli`, as the menu reports it.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CliToolStatus {
    /// Where the tool is (or would be) installed.
    pub path: String,
    pub installed: bool,
    /// The app version the installed copy came from (absent for an unknown copy).
    pub recorded_version: Option<String>,
    /// The running app's version — what a refresh installs.
    pub current_version: String,
    /// Installed, but not from this app version (or with no recorded version).
    pub stale: bool,
    /// Whether the install directory is on `PATH`, so `hey-listen-cli` just works.
    pub on_path: bool,
}

/// The installed binary's path inside `target_dir`.
pub fn binary_path(target_dir: &Path) -> PathBuf {
    target_dir.join(exe_name())
}

/// The version record written beside the binary (`hey-listen-cli.version`).
fn version_path(target_dir: &Path) -> PathBuf {
    let mut path = binary_path(target_dir).into_os_string();
    path.push(".version");
    PathBuf::from(path)
}

/// Where the tool is installed in place of the bundled copy.
fn exe_name() -> &'static str {
    if cfg!(windows) {
        "hey-listen-cli.exe"
    } else {
        "hey-listen-cli"
    }
}

/// The per-user bin directory: `~/.local/bin` on macOS/Linux,
/// `%LOCALAPPDATA%\hey-listen\bin` on Windows.
pub fn default_target_dir() -> Result<PathBuf, CliInstallError> {
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .ok_or(CliInstallError::NoTargetDir)
            .map(PathBuf::from)?;
        Ok(base.join("hey-listen").join("bin"))
    }

    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME")
            .ok_or(CliInstallError::NoTargetDir)
            .map(PathBuf::from)?;
        Ok(home.join(".local").join("bin"))
    }
}

/// Copy `sidecar_src` to `target_dir` and record [`APP_VERSION`].
///
/// Copy-then-swap: the copy lands as `<name>.new`, is made executable, and only then
/// renamed over the installed binary. A failure at any step leaves the previous install
/// exactly as it was.
pub fn install(sidecar_src: &Path, target_dir: &Path) -> Result<PathBuf, CliInstallError> {
    if !sidecar_src.is_file() {
        return Err(CliInstallError::SidecarMissing(
            sidecar_src.display().to_string(),
        ));
    }

    fs::create_dir_all(target_dir)?;
    let dest = binary_path(target_dir);
    let staged = target_dir.join(format!("{}.new", exe_name()));

    // A leftover from an interrupted copy would make the rename fail on Windows.
    let _ = fs::remove_file(&staged);
    fs::copy(sidecar_src, &staged)?;
    make_executable(&staged)?;

    // A running copy holds the destination open on Windows: the rename then fails and the
    // old install stays usable (the caller reports it).
    fs::rename(&staged, &dest).map_err(|err| {
        let _ = fs::remove_file(&staged);
        CliInstallError::Io(err)
    })?;

    // Record the version *after* the swap: if this write fails the old version stays
    // recorded, so the next launch simply refreshes again instead of claiming a version
    // the binary is not.
    write_version(target_dir)?;
    Ok(dest)
}

/// Refresh an installed CLI when it came from another app version; `true` when it did.
///
/// Nothing is installed here — an absent CLI is M33.D's job, so a user who never asked
/// for the tool does not silently get one.
pub fn refresh_if_stale(sidecar_src: &Path, target_dir: &Path) -> Result<bool, CliInstallError> {
    if binary_path(target_dir).is_file()
        && recorded_version(target_dir).as_deref() == Some(APP_VERSION)
    {
        return Ok(false);
    }
    install(sidecar_src, target_dir)?;
    Ok(true)
}

/// Remove the installed binary and its version record; `true` when anything was removed.
pub fn uninstall(target_dir: &Path) -> Result<bool, CliInstallError> {
    let mut removed = false;
    for path in [binary_path(target_dir), version_path(target_dir)] {
        match fs::remove_file(&path) {
            Ok(()) => removed = true,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(removed)
}

/// The installed CLI's state, for the menu (M33.D) and the startup refresh.
pub fn status(target_dir: &Path) -> CliToolStatus {
    let path = binary_path(target_dir);
    let installed = path.is_file();
    let recorded = recorded_version(target_dir);
    CliToolStatus {
        stale: installed && recorded.as_deref() != Some(APP_VERSION),
        path: path.display().to_string(),
        installed,
        recorded_version: recorded,
        current_version: APP_VERSION.to_string(),
        on_path: dir_on_path(target_dir),
    }
}

/// The version record, when the tool was installed by this app.
pub fn recorded_version(target_dir: &Path) -> Option<String> {
    fs::read_to_string(version_path(target_dir))
        .ok()
        .map(|version| version.trim().to_string())
        .filter(|version| !version.is_empty())
}

/// The `hey-listen-cli` this build ships, wherever the running form keeps it.
///
/// A bundle puts the sidecar beside the app binary (macOS `Contents/MacOS`, the Linux
/// `usr/bin`, the Windows install directory), which is also where `tauri dev` stages it;
/// a bare `cargo run` in a checkout has only the script-staged
/// `src-tauri/binaries/hey-listen-cli-<triple>`.
pub fn bundled_sidecar<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        candidates.push(dir.join(exe_name()));
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("binaries").join(exe_name()));
    }
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!(
                "{BINARY_NAME}-{}",
                env!("HEY_LISTEN_TARGET_TRIPLE")
            )),
    );

    candidates.into_iter().find(|path| path.is_file())
}

/// Refresh an installed CLI on launch, off the main thread, without blocking startup.
///
/// Called from `setup`; a no-op for a user who never installed the tool, and a log line
/// (never a dialog) when it cannot refresh.
pub fn refresh_on_startup<R: Runtime>(app: &AppHandle<R>) {
    let Some(sidecar) = bundled_sidecar(app) else {
        return;
    };
    let Ok(target_dir) = default_target_dir() else {
        return;
    };
    if !binary_path(&target_dir).is_file() {
        return;
    }

    tauri::async_runtime::spawn_blocking(move || match refresh_if_stale(&sidecar, &target_dir) {
        Ok(true) => log::info!("refreshed the installed hey-listen-cli to {APP_VERSION}"),
        Ok(false) => {}
        Err(err) => log::warn!("could not refresh the installed hey-listen-cli: {err}"),
    });
}

/// Where the CLI is installed, and whether it matches this app version.
#[tauri::command]
pub fn cli_tool_status() -> Result<CliToolStatus, CliInstallError> {
    Ok(status(&default_target_dir()?))
}

/// Install (or refresh) the bundled CLI, returning the path it wrote.
#[tauri::command]
pub fn cli_tool_install(app: AppHandle) -> Result<String, CliInstallError> {
    let target_dir = default_target_dir()?;
    let sidecar = bundled_sidecar(&app).ok_or_else(|| {
        CliInstallError::SidecarMissing(format!(
            "{} beside the app or in its resources",
            exe_name()
        ))
    })?;
    let path = install(&sidecar, &target_dir)?;
    Ok(path.display().to_string())
}

/// Remove an installed CLI; `true` when anything was removed.
#[tauri::command]
pub fn cli_tool_uninstall() -> Result<bool, CliInstallError> {
    uninstall(&default_target_dir()?)
}

fn write_version(target_dir: &Path) -> std::io::Result<()> {
    let dest = version_path(target_dir);
    let staged = dest.with_extension("version.new");
    fs::write(&staged, format!("{APP_VERSION}\n"))?;
    fs::rename(&staged, &dest)
}

#[cfg(unix)]
fn make_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> std::io::Result<()> {
    // Windows has no executable bit; the `.exe` suffix is the whole story.
    Ok(())
}

fn dir_on_path(dir: &Path) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|entry| same_dir(&entry, dir)))
}

fn same_dir(a: &Path, b: &Path) -> bool {
    a == b
        || matches!(
            (fs::canonicalize(a), fs::canonicalize(b)),
            (Ok(a), Ok(b)) if a == b
        )
}

#[cfg(test)]
mod tests;
