//! Native application menu (File / Edit / View / Window / Help).
//!
//! The File and Edit actions are emitted to the frontend on the [`MENU_EVENT`]
//! channel — the frontend owns the project state (`state/project/` reacts to the
//! File actions; `state/menu.ts` routes undo/redo to `state/history.ts`). View and
//! Window use **predefined** items (fullscreen / minimize / maximize), so they work
//! without a round-trip. On macOS the first submenu is the application menu
//! (About / Services / Hide / Quit); elsewhere About lives under Help.
//!
//! **File → Open Recent** is rebuilt from [`crate::recent`] whenever the list changes
//! ([`rebuild`]); choosing an entry re-emits it as an open request.
//!
//! See `docs/ui-layout.md` and `docs/architecture.md`.

use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

use crate::commands::{focused_label, project::OPEN_EVENT};
use crate::recent::{self, RecentProject};

/// Event carrying a menu action id (File / Edit) to the frontend.
pub const MENU_EVENT: &str = "app:menu";

/// The actions the frontend handles (ids match `state/project/`, `state/menu.ts` and
/// `state/history.ts`). The native menu and the emitted event share these ids.
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
    Save,
    SaveAs,
    Undo,
    Redo,
    About,
    Compare,
}

/// Id prefix for an "Open Recent" entry; the rest of the id is the file path.
const RECENT_PREFIX: &str = "recent:";
/// Id of the "Open Recent → Clear Menu" item.
const RECENT_CLEAR: &str = "recent-clear";

/// Build the application menu, ready for `App::set_menu`.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let recent = recent_submenu(app, &recent::existing(app))?;

    let new = MenuItem::with_id(
        app,
        MenuAction::New.as_ref(),
        "New Project",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let new_window = MenuItem::with_id(
        app,
        MenuAction::NewWindow.as_ref(),
        "New Window",
        true,
        Some("CmdOrCtrl+Shift+N"),
    )?;
    let open = MenuItem::with_id(
        app,
        MenuAction::Open.as_ref(),
        "Open Project…",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let save = MenuItem::with_id(
        app,
        MenuAction::Save.as_ref(),
        "Save",
        true,
        Some("CmdOrCtrl+S"),
    )?;
    let save_as = MenuItem::with_id(
        app,
        MenuAction::SaveAs.as_ref(),
        "Save As…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let sep_after_open = PredefinedMenuItem::separator(app)?;
    let sep_after_save = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "macos")]
    let trailing = PredefinedMenuItem::close_window(app, Some("Close Window"))?;
    #[cfg(not(target_os = "macos"))]
    let trailing = PredefinedMenuItem::quit(app, Some("Quit"))?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new,
            &new_window,
            &open,
            &recent,
            &sep_after_open,
            &save,
            &save_as,
            &sep_after_save,
            &trailing,
        ],
    )?;

    // Edit → Undo / Redo emit to the frontend (the app-level history lives there).
    let undo = MenuItem::with_id(
        app,
        MenuAction::Undo.as_ref(),
        "Undo",
        true,
        Some("CmdOrCtrl+Z"),
    )?;
    let redo = MenuItem::with_id(
        app,
        MenuAction::Redo.as_ref(),
        "Redo",
        true,
        Some("Shift+CmdOrCtrl+Z"),
    )?;
    let edit = Submenu::with_items(app, "Edit", true, &[&undo, &redo])?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    // Analysis → Compare with… acts on the focused analyzer tab (M25). The item is
    // emitted to the frontend, which owns the Workbench and the target picker.
    let compare = MenuItem::with_id(
        app,
        MenuAction::Compare.as_ref(),
        "Compare with…",
        true,
        None::<&str>,
    )?;
    let analysis = Submenu::with_items(app, "Analysis", true, &[&compare])?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;

    // About opens the in-app dialog (required attributions live there); it is a
    // custom item rather than the predefined panel, so it is routed to the frontend.
    let about = MenuItem::with_id(
        app,
        MenuAction::About.as_ref(),
        "About Hey Listen",
        true,
        None::<&str>,
    )?;

    // About lives in the macOS application menu; elsewhere it lives under Help.
    #[cfg(target_os = "macos")]
    let help = Submenu::with_items(app, "Help", true, &[] as &[&dyn IsMenuItem<R>])?;
    #[cfg(not(target_os = "macos"))]
    let help = Submenu::with_items(app, "Help", true, &[&about])?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "Hey Listen",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[&app_menu, &file, &edit, &view, &analysis, &window, &help],
    )?;
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &edit, &view, &analysis, &window, &help])?;

    Ok(menu)
}

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
        assert_eq!(MenuAction::Save.as_ref(), "save");
        assert_eq!(MenuAction::SaveAs.as_ref(), "saveAs");
        assert_eq!(MenuAction::Undo.as_ref(), "undo");
        assert_eq!(MenuAction::Redo.as_ref(), "redo");
        assert_eq!(MenuAction::About.as_ref(), "about");
        assert_eq!(MenuAction::Compare.as_ref(), "compare");
        for action in MenuAction::iter() {
            assert_eq!(action.as_ref().parse::<MenuAction>(), Ok(action));
        }
    }
}
