//! Native compare windows (M25): a popout shows one comparison, aliased to its owner
//! project. A compare popout is registered separately from tool popouts, so it is never
//! saved or restored as a tool — only its **content** is project content (M25.C).

use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::audio::analyzers::AnalyzerId;
use crate::commands::window::{next_label, raise};
use crate::state::{window_state, CompareView, WindowRegistry, WindowState};

use super::peer::peer_state;

/// Open a compare popout for `tool`, or raise/retarget the one already open.
///
/// `saved: true` shows the owner's saved reference snapshot (M25.C); otherwise
/// `reference` names a live project label.
#[tauri::command]
pub async fn open_compare_popout(
    window: WebviewWindow,
    tool: AnalyzerId,
    reference: Option<String>,
    saved: bool,
) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<WindowRegistry>();
    let parent = registry.root_label(window.label());
    let state = window_state(&window);
    let view = compare_view(&state, tool, reference.as_deref(), saved)?;
    if !view.saved {
        peer_state(app, &view.with)?;
    }

    if let Some(existing) = registry.compare_popout_for(&parent, tool) {
        if let Some(popout) = app.get_webview_window(&existing) {
            registry.retarget_compare_popout(&existing, &view.with, view.saved);
            raise(&popout);
            return Ok(());
        }
        registry.remove(&existing);
    }
    let label = next_label("compare");
    registry.add_compare_popout(&label, &parent, view);
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Compare — Hey Listen")
        .inner_size(1_000.0, 680.0)
        .min_inner_size(560.0, 400.0)
        .build();
    if let Err(err) = built {
        registry.remove(&label);
        return Err(err.to_string());
    }
    Ok(())
}

/// Retarget the **calling** compare popout at another reference project or its saved
/// snapshot.
#[tauri::command]
pub fn retarget_compare_popout(
    window: WebviewWindow,
    reference: Option<String>,
    saved: bool,
) -> Result<(), String> {
    let registry = window.app_handle().state::<WindowRegistry>();
    let Some(current) = registry.compare_popout(window.label()) else {
        return Err("this window is not a comparison".to_string());
    };
    let state = window_state(&window);
    let next = compare_view(&state, current.tool, reference.as_deref(), saved)?;
    if !next.saved {
        peer_state(window.app_handle(), &next.with)?;
    }
    registry.retarget_compare_popout(window.label(), &next.with, next.saved);
    Ok(())
}

/// The compare view a popout shows, or `None` for any other window.
#[tauri::command]
pub fn popout_compare(window: WebviewWindow) -> Option<CompareView> {
    let registry = window.app_handle().state::<WindowRegistry>();
    registry.compare_popout(window.label())
}

/// Resolve a popout's `(tool, reference, saved)` into the view it shows.
fn compare_view(
    state: &WindowState,
    tool: AnalyzerId,
    reference: Option<&str>,
    saved: bool,
) -> Result<CompareView, String> {
    if saved {
        let snapshot = state
            .saved_comparison(tool)
            .ok_or_else(|| format!("no saved comparison for '{tool}'"))?;
        return Ok(CompareView {
            tool,
            with: snapshot.reference_name,
            saved: true,
        });
    }
    let reference = reference.ok_or_else(|| "`reference` is required".to_string())?;
    Ok(CompareView {
        tool,
        with: reference.to_string(),
        saved: false,
    })
}

/// The compare popouts of the calling project (for `get_state`; never saved).
#[tauri::command]
pub fn compare_popouts(window: WebviewWindow) -> Vec<CompareView> {
    let registry = window.app_handle().state::<WindowRegistry>();
    registry.compare_popouts_of(&registry.root_label(window.label()))
}
