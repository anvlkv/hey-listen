//! App-shell commands: opening a URL in the user's browser, telling the frontend
//! whether the E2E service launched this process, and reporting the running build's
//! identity.
//!
//! The About dialog lists license pages; a webview anchor would not leave the app
//! (Tauri does not navigate to external URLs by default), so the frontend asks the
//! core to hand the URL to the OS instead. Only `http(s)` is allowed, so the command
//! cannot be turned into a generic "launch anything" primitive.

use serde::Serialize;

/// The running binary's identity, for the About dialog.
///
/// The commit/profile/target are embedded by `build.rs` at compile time, so they
/// describe the binary even when it is copied away from its checkout. The format version
/// comes from [`crate::project::VERSION`], the one place the `.heyl` container version
/// lives.
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BuildInfo {
    /// The running app's version (`CARGO_PKG_VERSION`).
    pub version: String,
    /// The `.heyl` container version this build reads and writes.
    pub format_version: u32,
    /// The short git commit the build came from (`unknown` outside a checkout).
    pub commit: String,
    /// Whether the worktree had uncommitted changes when the build was produced.
    pub commit_dirty: bool,
    /// The Cargo profile (`debug` / `release`).
    pub profile: String,
    /// The target triple the binary was built for.
    pub target: String,
}

/// The identity of the running binary (see [`BuildInfo`]).
#[tauri::command]
pub fn build_info() -> BuildInfo {
    BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        format_version: crate::project::VERSION,
        commit: option_env!("HEYLISTEN_BUILD_COMMIT")
            .unwrap_or("unknown")
            .to_string(),
        commit_dirty: option_env!("HEYLISTEN_BUILD_DIRTY") == Some("true"),
        profile: option_env!("HEYLISTEN_BUILD_PROFILE")
            .unwrap_or("unknown")
            .to_string(),
        target: option_env!("HEYLISTEN_BUILD_TARGET")
            .unwrap_or("unknown")
            .to_string(),
    }
}

/// Whether this process was launched by the E2E service (`TAURI_WEBDRIVER_PORT`
/// set), i.e. the only case where the WebDriver plugins are registered and the
/// frontend should load `@wdio/tauri-plugin`. See `docs/testing.md`.
#[tauri::command]
pub fn e2e_enabled() -> bool {
    std::env::var(tauri_plugin_wdio_webdriver::PORT_ENV_VAR).is_ok()
}

/// Open `url` in the system browser.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("refusing to open a non-http(s) URL: {url}"));
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(&url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        // `start` is a cmd builtin; the empty title arg keeps a quoted URL intact.
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", "", &url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(&url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("could not open {url}: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_info_reports_the_wire_format_and_a_build_identity() {
        let info = build_info();
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.format_version, crate::project::VERSION);
        assert!(!info.commit.is_empty());
        assert!(!info.profile.is_empty());
        assert!(!info.target.is_empty());
    }
}
