//! Native application menu (File / View / Window / Help).
//!
//! The File actions are emitted to the frontend on the [`MENU_EVENT`] channel — the
//! frontend owns the project state (`state/project.ts` reacts to them). View and
//! Window use **predefined** items (fullscreen / minimize / maximize), so they work
//! without a round-trip. There is no Edit menu (no document editing / history). On
//! macOS the first submenu is the application menu (About / Services / Hide / Quit);
//! elsewhere About lives under Help.
//!
//! **File → Open Recent** is rebuilt from [`crate::recent`] whenever the list changes
//! ([`rebuild`]); choosing an entry re-emits it as an open request.
//!
//! See `docs/ui-layout.md` and `docs/architecture.md`.

use tauri::menu::{
    AboutMetadata, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Emitter, Runtime};

use crate::commands::project::OPEN_EVENT;
use crate::recent::{self, RecentProject};

/// Event carrying a File-menu action id to the frontend.
pub const MENU_EVENT: &str = "app:menu";

/// The File actions the frontend handles (ids match `state/project.ts`).
const FILE_ACTIONS: [&str; 4] = ["new", "open", "save", "saveAs"];

/// Id prefix for an "Open Recent" entry; the rest of the id is the file path.
const RECENT_PREFIX: &str = "recent:";
/// Id of the "Open Recent → Clear Menu" item.
const RECENT_CLEAR: &str = "recent-clear";

/// Build the application menu, ready for `App::set_menu`.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let recent = recent_submenu(app, &recent::existing(app))?;

    let new = MenuItem::with_id(app, "new", "New Project", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(app, "open", "Open Project…", true, Some("CmdOrCtrl+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "saveAs", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
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
            &open,
            &recent,
            &sep_after_open,
            &save,
            &save_as,
            &sep_after_save,
            &trailing,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
        ],
    )?;

    // About lives in the macOS application menu; elsewhere it lives under Help.
    #[cfg(target_os = "macos")]
    let help = Submenu::with_items(app, "Help", true, &[] as &[&dyn IsMenuItem<R>])?;
    #[cfg(not(target_os = "macos"))]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&PredefinedMenuItem::about(
            app,
            Some("About Hey Listen"),
            Some(about_metadata()),
        )?],
    )?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        app,
        "Hey Listen",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about_metadata()))?,
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
    let menu = Menu::with_items(app, &[&app_menu, &file, &view, &window, &help])?;
    #[cfg(not(target_os = "macos"))]
    let menu = Menu::with_items(app, &[&file, &view, &window, &help])?;

    Ok(menu)
}

/// Rebuild and install the menu (after the recent-projects list changes).
pub fn rebuild<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build(app)?;
    app.set_menu(menu)?;
    Ok(())
}

/// Emit a File-menu action to the frontend; other items are handled natively.
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
            let _ = app.emit(OPEN_EVENT, vec![path.to_string()]);
        }
        return;
    }

    if FILE_ACTIONS.contains(&id) {
        let _ = app.emit(MENU_EVENT, id);
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

fn about_metadata() -> AboutMetadata<'static> {
    AboutMetadata {
        name: Some("Hey Listen".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        comments: Some("Audio analysis workbench".to_string()),
        ..Default::default()
    }
}
