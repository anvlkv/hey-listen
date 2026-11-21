//! Native application menu (File / Edit / View / Window / Help).
//!
//! The menu actions the frontend owns are emitted on the [`MENU_EVENT`] channel —
//! `state/project/` reacts to the File actions and `state/menu.ts` routes the rest
//! (Analysis, Help). View and Window use **predefined** items (fullscreen / minimize /
//! maximize), so they work without a round-trip. Undo/redo are **not** menu items: they
//! are commands in the frontend's keybinding registry (see `docs/undo-redo.md`), so a
//! focused text field keeps native `Cmd+Z`. On macOS the first submenu is the application
//! menu (About / Services / Hide / Quit); elsewhere About lives under Help.
//!
//! **File → Open Recent** is rebuilt from [`crate::recent`] whenever the list changes
//! ([`rebuild`]); choosing an entry re-emits it as an open request.
//!
//! The submenus and their items live in [`build`] (a child module), so this module stays
//! the event surface: the action ids, the recent list, and the routing.
//!
//! See `docs/ui-layout.md` and `docs/architecture.md`.

use tauri::menu::{IsMenuItem, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

use crate::commands::{focused_label, project::OPEN_EVENT};
use crate::recent::{self, RecentProject};

mod build;

pub use build::build;

/// Event carrying a menu action id (File / Analysis / Help) to the frontend.
pub const MENU_EVENT: &str = "app:menu";

/// The actions the frontend handles (ids match `state/menu.ts` and `state/project/`).
/// The native menu and the emitted event share these ids.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    strum::EnumString,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
    strum::VariantNames,
)]
#[strum(serialize_all = "camelCase")]
pub enum MenuAction {
    New,
    NewWindow,
    Open,
    PreviousProject,
    NextProject,
    Save,
    SaveAs,
    About,
    Compare,
    CheckForUpdates,
    InstallCliTool,
    /// Open the in-app Keyboard Shortcuts dialog (handled by the frontend).
    Shortcuts,
    /// Show the log preview (handled natively: the core raises the window).
    ShowLog,
    /// Reveal the log directory (handled natively: the core opens it).
    OpenLogFolder,
}

/// Id prefix for an "Open Recent" entry; the rest of the id is the file path.
const RECENT_PREFIX: &str = "recent:";
/// Id of the "Open Recent → Clear Menu" item.
const RECENT_CLEAR: &str = "recent-clear";

/// Rebuild and install the menu (after the recent-projects list changes).
pub fn rebuild<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build(app)?;
    app.set_menu(menu)?;
    Ok(())
}

/// Emit a File/Edit action to the frontend; other items are handled natively.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    let id = event.id().as_ref();

    if id == RECENT_CLEAR {
        // Rebuild once the current menu event has been dispatched.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            recent::clear(&handle);
            let _ = rebuild(&handle);
        });
        return;
    }

    if let Some(path) = id.strip_prefix(RECENT_PREFIX) {
        // `recent:none` is the disabled placeholder and never fires, but guard anyway.
        if !path.is_empty() && path != "none" {
            // Same routing as an OS file-open (`handle_open_paths`): the **focused** project
            // window opens it, not every window (`Emitter::emit` is a global broadcast).
            if let Some(label) = focused_label(app) {
                let _ = app.emit_to(label, OPEN_EVENT, vec![path.to_string()]);
            }
        }
        return;
    }

    if let Ok(action) = id.parse::<MenuAction>() {
        match action {
            // The two log actions are native: no webview round trip, so nothing is lost
            // while a window is still booting (and the preview needs no project window).
            MenuAction::OpenLogFolder => {
                if let Err(err) = crate::logging::open_dir(app) {
                    log::warn!("could not reveal the log directory: {err}");
                }
                return;
            }
            MenuAction::ShowLog => {
                // Built off the menu's (main) thread: a window created synchronously in the
                // menu handler deadlocks the event loop on Windows, exactly as an async
                // command avoids it.
                let parent = focused_label(app);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let Some(parent) = parent else {
                        return;
                    };
                    if let Err(err) = crate::commands::window::open_log_window_for(&handle, &parent)
                    {
                        log::warn!("could not open the log preview: {err}");
                    }
                });
                return;
            }
            _ => {}
        }

        // Emit only to the focused window: with N project windows, a menu action must
        // apply to the project the user is looking at (M7), not broadcast.
        if let Some(label) = focused_label(app) {
            let _ = app.emit_to(label, MENU_EVENT, action.as_ref());
        }
    }
}

/// The "Open Recent" submenu: one item per existing file, then Clear Menu.
fn recent_submenu<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[RecentProject],
) -> tauri::Result<Submenu<R>> {
    if recents.is_empty() {
        let empty = MenuItem::with_id(
            app,
            "recent:none",
            "No Recent Projects",
            false,
            None::<&str>,
        )?;
        return Submenu::with_items(app, "Open Recent", true, &[&empty]);
    }

    let mut entries = Vec::with_capacity(recents.len());
    for item in recents {
        entries.push(MenuItem::with_id(
            app,
            format!("{RECENT_PREFIX}{}", item.path),
            &item.name,
            true,
            None::<&str>,
        )?);
    }
    let separator = PredefinedMenuItem::separator(app)?;
    let clear = MenuItem::with_id(app, RECENT_CLEAR, "Clear Menu", true, None::<&str>)?;

    let mut items: Vec<&dyn IsMenuItem<R>> = entries
        .iter()
        .map(|entry| entry as &dyn IsMenuItem<R>)
        .collect();
    items.push(&separator);
    items.push(&clear);
    Submenu::with_items(app, "Open Recent", true, &items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use strum::IntoEnumIterator;

    #[test]
    fn action_ids_match_the_frontend() {
        // The frontend routes these exact strings (`state/menu.ts`).
        assert_eq!(MenuAction::New.as_ref(), "new");
        assert_eq!(MenuAction::NewWindow.as_ref(), "newWindow");
        assert_eq!(MenuAction::Open.as_ref(), "open");
        assert_eq!(MenuAction::PreviousProject.as_ref(), "previousProject");
        assert_eq!(MenuAction::NextProject.as_ref(), "nextProject");
        assert_eq!(MenuAction::Save.as_ref(), "save");
        assert_eq!(MenuAction::SaveAs.as_ref(), "saveAs");
        assert_eq!(MenuAction::About.as_ref(), "about");
        assert_eq!(MenuAction::Compare.as_ref(), "compare");
        assert_eq!(MenuAction::CheckForUpdates.as_ref(), "checkForUpdates");
        assert_eq!(MenuAction::InstallCliTool.as_ref(), "installCliTool");
        assert_eq!(MenuAction::Shortcuts.as_ref(), "shortcuts");
        assert_eq!(MenuAction::ShowLog.as_ref(), "showLog");
        assert_eq!(MenuAction::OpenLogFolder.as_ref(), "openLogFolder");
        for action in MenuAction::iter() {
            assert_eq!(action.as_ref().parse::<MenuAction>(), Ok(action));
        }
    }
}
