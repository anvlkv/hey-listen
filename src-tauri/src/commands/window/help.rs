//! The **manual** window (Help → Hey Listen Manual).
//!
//! The chapters are the same ones the published site shows, built into the app bundle
//! (`help/docs/`, written by `npm run help`) and rendered with docs-only chrome. The
//! window is a **reader**: it never leaves that tree, and an outside address is handed to
//! the system browser instead of replacing the page.

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use super::raise;

/// Label of the app-wide manual window.
pub(super) const HELP_LABEL: &str = "help";

/// Open (or raise) the **manual** window: the chapters the app ships with, rendered by
/// the same docs layout as the published site (M35).
///
/// A singleton like the Keyboard Shortcuts window, and equally app-wide: it is not a
/// project view, so it is never aliased and survives a project load. Every chapter and
/// screenshot works offline because the pages come from the bundle itself.
pub(crate) fn open_help_window_for<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(HELP_LABEL) {
        raise(&existing);
        return Ok(());
    }

    // In `tauri dev` the tree is served by Vite, so the app origin is the dev server.
    let dev = app.config().build.dev_url.clone();
    WebviewWindowBuilder::new(
        app,
        HELP_LABEL,
        WebviewUrl::App("help/docs/index.html".into()),
    )
    .title("Hey Listen Manual")
    // Wide enough for the three-column docs layout (the landing hides the on-page
    // contents at 1080 px).
    .inner_size(1140.0, 820.0)
    .min_inner_size(620.0, 480.0)
    .on_navigation(move |url| manual_navigation(url, dev.as_ref()))
    .build()
    .map_err(|err| err.to_string())?;
    Ok(())
}

/// Whether the manual window may load `url`.
///
/// It may only navigate inside the bundled `help/` tree. Anything else is refused: an
/// `http(s)` address (the repository, an article) opens in the user's browser instead of
/// replacing the manual, and every other scheme is simply blocked.
fn manual_navigation(url: &Url, dev: Option<&Url>) -> bool {
    if manual_url_allowed(url, dev) {
        return true;
    }
    if url.scheme() == "http" || url.scheme() == "https" {
        if let Err(err) = crate::commands::app::open_external_url(url.as_str().to_string()) {
            log::warn!("could not open {url} in the browser: {err}");
        }
    }
    false
}

/// The manual's pages, and only those: the bundled `help/` path on the app's own origin
/// (the asset protocol in a build, the dev server under `tauri dev`).
fn manual_url_allowed(url: &Url, dev: Option<&Url>) -> bool {
    url.path().starts_with("/help/") && is_app_origin(url, dev)
}

/// Whether `url` comes from the app itself rather than the network.
fn is_app_origin(url: &Url, dev: Option<&Url>) -> bool {
    if let Some(dev) = dev {
        if url.scheme() == dev.scheme()
            && url.host_str() == dev.host_str()
            && url.port_or_known_default() == dev.port_or_known_default()
        {
            return true;
        }
    }
    // tauri:// on macOS, http://tauri.localhost on Windows and Linux.
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(raw: &str) -> Url {
        Url::parse(raw).expect("a valid url")
    }

    #[test]
    fn the_manual_window_stays_inside_the_bundled_tree() {
        // A build: the asset protocol serves the frontend (macOS, then Windows/Linux).
        assert!(manual_url_allowed(
            &parse("tauri://localhost/help/docs/index.html"),
            None
        ));
        assert!(manual_url_allowed(
            &parse("http://tauri.localhost/help/docs/001-shell/"),
            None
        ));
        // A dev run: the same tree, served by Vite.
        let dev = parse("http://localhost:1420");
        assert!(manual_url_allowed(
            &parse("http://localhost:1420/help/docs/001-shell/#the-simple-path"),
            Some(&dev)
        ));
    }

    #[test]
    fn the_manual_window_refuses_the_app_and_the_network() {
        // Not the manual's tree, even on the app's own origin.
        assert!(!manual_url_allowed(
            &parse("tauri://localhost/index.html"),
            None
        ));
        // Another site, however similar the path looks.
        assert!(!manual_url_allowed(
            &parse("https://example.com/help/docs/index.html"),
            None
        ));
        // Another port on the dev machine is not the dev server.
        let dev = parse("http://localhost:1420");
        assert!(!manual_url_allowed(
            &parse("http://localhost:9999/help/docs/index.html"),
            Some(&dev)
        ));
    }
}
