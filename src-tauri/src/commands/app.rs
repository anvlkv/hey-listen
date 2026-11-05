//! App-shell commands: opening a URL in the user's browser, and telling the
//! frontend whether the E2E service launched this process.
//!
//! The About dialog lists license pages; a webview anchor would not leave the app
//! (Tauri does not navigate to external URLs by default), so the frontend asks the
//! core to hand the URL to the OS instead. Only `http(s)` is allowed, so the command
//! cannot be turned into a generic "launch anything" primitive.

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
