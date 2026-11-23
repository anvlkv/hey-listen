//! The application menu's items and submenus.
//!
//! Split from `menu/mod.rs` (the event surface) to keep both files small. The ids come
//! from [`super::MenuAction`], so a label and the action it fires are stated together with
//! the id the frontend parses.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

use super::{recent_submenu, MenuAction};
use crate::recent;

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
    // Step through the `.heyl` files beside the current project (M25.D).
    let previous_project = MenuItem::with_id(
        app,
        MenuAction::PreviousProject.as_ref(),
        "Previous Project",
        true,
        Some("CmdOrCtrl+Alt+Left"),
    )?;
    let next_project = MenuItem::with_id(
        app,
        MenuAction::NextProject.as_ref(),
        "Next Project",
        true,
        Some("CmdOrCtrl+Alt+Right"),
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
            &previous_project,
            &next_project,
            &recent,
            &sep_after_open,
            &save,
            &save_as,
            &sep_after_save,
            &trailing,
        ],
    )?;

    // Edit → the clipboard items must be **predefined**: macOS dispatches Cmd+C / Cmd+X /
    // Cmd+V / Cmd+A through the Edit menu's key equivalents to the focused responder,
    // so without them a text field (e.g. the annotation editor) cannot copy or paste
    // at all — the WebView never sees the shortcut. Undo/redo are deliberately absent:
    // they are keybinding-registry commands, so a text field keeps native text undo
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit = Submenu::with_items(app, "Edit", true, &[&cut, &copy, &paste, &select_all])?;

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

    // Updates (M33.C) open the same About dialog, with the update status in it.
    let check_updates = MenuItem::with_id(
        app,
        MenuAction::CheckForUpdates.as_ref(),
        "Check for Updates…",
        true,
        None::<&str>,
    )?;

    // The CLI install dialog (M33.D) reports the real state (Install / Update / Repair /
    // Uninstall), so its label never has to change with the installed version.
    let install_cli = MenuItem::with_id(
        app,
        MenuAction::InstallCliTool.as_ref(),
        "Install Command Line Tool…",
        true,
        None::<&str>,
    )?;

    // The shortcut sheet is frontend content: the menu only opens it. Placed beside the
    // other Help items on every platform (on macOS About lives in the app menu).
    let shortcuts = MenuItem::with_id(
        app,
        MenuAction::Shortcuts.as_ref(),
        "Keyboard Shortcuts…",
        true,
        None::<&str>,
    )?;

    // The log actions (ADR-33) need no webview at all: the core opens the folder or
    // raises the preview itself, so they work before a window has finished booting.
    let show_log = MenuItem::with_id(
        app,
        MenuAction::ShowLog.as_ref(),
        "Show Log…",
        true,
        None::<&str>,
    )?;
    let open_log_folder = MenuItem::with_id(
        app,
        MenuAction::OpenLogFolder.as_ref(),
        "Open Log Folder",
        true,
        None::<&str>,
    )?;

    // About lives in the macOS application menu; elsewhere it lives under Help.
    #[cfg(target_os = "macos")]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &show_log,
            &open_log_folder,
            &check_updates,
            &shortcuts,
            &install_cli,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &about,
            &show_log,
            &open_log_folder,
            &check_updates,
            &shortcuts,
            &install_cli,
        ],
    )?;

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
