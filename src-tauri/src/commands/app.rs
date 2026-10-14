//! App-shell commands: opening a URL in the user's browser.
//!
//! The About dialog lists license pages; a webview anchor would not leave the app
//! (Tauri does not navigate to external URLs by default), so the frontend asks the
//! core to hand the URL to the OS instead. Only `http(s)` is allowed, so the command
//! cannot be turned into a generic "launch anything" primitive.

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
