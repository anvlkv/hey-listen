//! Open (or raise) the project a compare view is bound to (M25.D).
//!
//! A compare view names its other side but gives no way to reach it: a **live**
//! reference already lives in another project window (possibly behind this one), while
//! a **saved** reference has no window at all until its project file is opened again.
//! This command resolves both cases from one button:
//!
//! 1. a live reference label → raise that window;
//! 2. a saved reference name that matches an **open** project → raise that window;
//! 3. a saved reference name that matches a **recent** project file → open a new
//!    project window at that file;
//! 4. otherwise report what to do instead.
//!
//! The new window learns its project path through [`crate::commands::window::project::PendingWindowPaths`]:
//! the frontend drains it once on startup (`take_window_open_path`), which avoids racing
//! a window that is still loading.

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::commands::window::project::open_project_window_at;
use crate::commands::window::raise;
use crate::state::WindowRegistry;

use super::peer::project_name;

/// Open the compare view's reference project, or raise the window that shows it.
///
/// `label` is a live reference (a project window label); `name` is a saved reference's
/// project display name. Returns `"focused"` or `"opened"`.
#[tauri::command]
pub fn open_reference_window(
    window: WebviewWindow,
    label: Option<String>,
    name: Option<String>,
) -> Result<String, String> {
    let app = window.app_handle();

    // 1. The live reference window itself.
    if let Some(label) = label.filter(|label| !label.is_empty()) {
        if let Some(target) = app.get_webview_window(&label) {
            raise(&target);
            return Ok("focused".to_string());
        }
    }

    let name = name.filter(|name| !name.is_empty());
    let Some(name) = name else {
        return Err("this comparison has no reference project to open".to_string());
    };

    // 2. An open project whose display name matches (a saved reference reconnected
    //    by hand, or the reference reopened since the comparison).
    if let Some(target) = open_project_named(app, &name) {
        raise(&target);
        return Ok("focused".to_string());
    }

    // 3. The most recent project file with that name (the file's stem is the project
    //    label the app saves with; a headless save may add a suffix to `META.name`).
    if let Some(path) = crate::recent::existing(app)
        .into_iter()
        .find(|item| name_matches(&name, &item.name))
        .map(|item| item.path)
    {
        open_project_window_at(app, path)?;
        return Ok("opened".to_string());
    }

    Err(format!(
        "no project file named “{name}” — open it from File → Open Recent, then compare again"
    ))
}

/// The open project window whose display name is `name` (never a popout).
fn open_project_named(app: &AppHandle, name: &str) -> Option<WebviewWindow> {
    let registry = app.state::<WindowRegistry>();
    let mut labels: Vec<String> = app.webview_windows().into_keys().collect();
    labels.sort();
    for label in labels {
        if registry.is_popout(&label) {
            continue;
        }
        let Some(state) = registry.peek(&label) else {
            continue;
        };
        if project_name(&state).as_deref() == Some(name) {
            if let Some(window) = app.get_webview_window(&label) {
                return Some(window);
            }
        }
    }
    None
}

/// Whether a saved reference's display name names the project file `stem`.
///
/// The app saves a project under its file stem, so the two are usually equal. A
/// headless save can set `META.name` independently — e.g. the species name followed by
/// ` synthesized` for the file of the species — so a stem followed by a space is
/// accepted too, never a partial word.
fn name_matches(reference: &str, stem: &str) -> bool {
    let reference = reference.to_lowercase();
    let stem = stem.to_lowercase();
    reference == stem
        || reference
            .strip_prefix(&stem)
            .is_some_and(|rest| rest.starts_with(' '))
}

#[cfg(test)]
mod tests {
    use super::name_matches;

    #[test]
    fn a_project_file_matches_its_own_stem_or_a_suffixed_display_name() {
        assert!(name_matches("acridotheres_tristis", "acridotheres_tristis"));
        assert!(name_matches(
            "acridotheres_tristis synthesized",
            "acridotheres_tristis"
        ));
        assert!(name_matches("A", "a"));
        // Never a partial word, and never a longer stem.
        assert!(!name_matches("acridotheres", "acridotheres_tristis"));
        assert!(!name_matches("acridotheresX", "acridotheres"));
    }
}
