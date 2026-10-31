//! The reference side of a comparison: its setup, live markers and picker targets.
//!
//! Peer reads never create state: a closed reference resolves to an error (the view
//! shows **Reference project closed**), and every value comes from the peer's shared UI
//! state or core `Playback`. See `docs/comparison.md`.

use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::audio::analysis::compare::{self, SourceShape, Span};
use crate::audio::analysis::{canonical_option_key, SharedParams, ToolOptions};
use crate::audio::analyzers::AnalyzerId;
use crate::state::{window_state, WindowRegistry, WindowState};

/// The reference project's setup, read from its shared UI state (M25).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerSetup {
    pub project: Option<String>,
    pub source: Option<SourceShape>,
    pub window: Span,
    pub params: SharedParams,
    /// The tool's **effective** options (defaults overlaid with the peer's overrides).
    pub options: Map<String, Value>,
    pub has_filter: bool,
}

/// Read the reference project's window, params, options and shape.
#[tauri::command]
pub fn compare_peer_setup(
    window: WebviewWindow,
    reference: String,
    tool: AnalyzerId,
) -> Result<PeerSetup, String> {
    let state = peer_state(window.app_handle(), &reference)?;
    let ui = state.ui_snapshot();
    let window = UiWindow::read(&ui, &state).span();
    let params = ui
        .get("params")
        .and_then(|value| serde_json::from_value::<SharedParams>(value.clone()).ok())
        .unwrap_or_default();
    let options = ui
        .get("toolOptions")
        .and_then(|value| value.get(tool.as_ref()).cloned())
        .map(|value| options_from_value(&value))
        .unwrap_or_default();
    Ok(PeerSetup {
        project: project_name(&state),
        source: compare::source_shape(&state).ok(),
        window,
        options: crate::audio::analyzers::effective_options(tool, Some(&options)),
        has_filter: has_filter(&state),
        params,
    })
}

/// Both sides' live playheads plus the reference's cursor and a revision (M25).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareLive {
    /// Whether the reference project is still open.
    pub open: bool,
    /// Bumped by any peer UI or audio change; a settled change re-runs the comparison.
    pub revision: u64,
    pub a: LiveSide,
    pub b: LiveSide,
}

/// One side's live markers.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSide {
    /// The core's preview position (source seconds), or `null` when stopped.
    pub playhead: Option<f64>,
    /// The peer's time cursor (source seconds), from its shared UI state.
    pub cursor_time: Option<f64>,
    /// The peer's frequency cursor (Hz).
    pub cursor_freq: Option<f64>,
    /// The peer's modulation-rate cursor (Hz).
    pub cursor_mod: Option<f64>,
}

/// Poll both playheads and the reference's cursor while a compare view is visible.
#[tauri::command]
pub fn compare_live(window: WebviewWindow, reference: String) -> CompareLive {
    let a_state = window_state(&window);
    let a = LiveSide {
        playhead: a_state.audio.playback.position(),
        ..Default::default()
    };
    let Some(b_state) = peer_state(window.app_handle(), &reference).ok() else {
        return CompareLive {
            open: false,
            revision: 0,
            a,
            b: LiveSide::default(),
        };
    };
    let ui = b_state.ui_snapshot();
    CompareLive {
        open: true,
        revision: b_state.revision(),
        a,
        b: LiveSide {
            playhead: b_state.audio.playback.position(),
            cursor_time: ui_number(&ui, "cursor:time"),
            cursor_freq: ui_number(&ui, "cursor:freq"),
            cursor_mod: ui_number(&ui, "cursor:mod"),
        },
    }
}

/// A comparison target: another open project the picker can reference.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareTarget {
    pub label: String,
    pub name: String,
    pub source: Option<SourceShape>,
    pub window: Option<Span>,
    pub has_filter: bool,
    /// A project with no source (or a brand-new window) is listed but disabled.
    pub ready: bool,
}

/// Every other open project window (never a popout) with what the picker and the
/// comparability badge need to predict a diff.
#[tauri::command]
pub fn compare_targets(window: WebviewWindow) -> Vec<CompareTarget> {
    let app = window.app_handle();
    let registry = app.state::<WindowRegistry>();
    let own = registry.root_label(window.label());
    let mut labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    labels.retain(|label| !registry.is_popout(label) && label != &own);
    labels.sort();
    labels
        .into_iter()
        .map(|label| {
            let state = registry.get(&label);
            let source = compare::source_shape(&state).ok();
            CompareTarget {
                name: project_name(&state).unwrap_or_else(|| label.clone()),
                window: Some(UiWindow::read(&state.ui_snapshot(), &state).span()),
                has_filter: has_filter(&state),
                ready: source.is_some(),
                source,
                label,
            }
        })
        .collect()
}

/// The live project state for `reference`, following a popout alias to its project.
/// A closed reference is an error — this never creates an empty state (ADR-24).
pub(super) fn peer_state(app: &AppHandle, reference: &str) -> Result<Arc<WindowState>, String> {
    let registry = app.state::<WindowRegistry>();
    let root = registry.root_label(reference);
    if app.get_webview_window(&root).is_none() {
        return Err(format!(
            "the reference project '{root}' is closed — open it (or pick another) to compare"
        ));
    }
    registry
        .peek(&root)
        .ok_or_else(|| format!("the reference project '{root}' has no state yet"))
}

/// The project's display name from its shared UI state, when it has one.
pub(super) fn project_name(state: &WindowState) -> Option<String> {
    state
        .ui_snapshot()
        .get("project")
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn has_filter(state: &WindowState) -> bool {
    state
        .audio
        .filter
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .is_some()
}

/// The peer's timeline window, falling back to the whole source.
struct UiWindow {
    start: f64,
    end: f64,
}

impl UiWindow {
    fn read(ui: &std::collections::HashMap<String, Value>, state: &WindowState) -> Self {
        let fallback = compare::source_shape(state)
            .map(|shape| shape.duration)
            .unwrap_or(0.0);
        let timeline = ui.get("timeline");
        let start = timeline
            .and_then(|value| value.get("windowStart"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let end = timeline
            .and_then(|value| value.get("windowEnd"))
            .and_then(Value::as_f64)
            .filter(|end| *end > start)
            .unwrap_or(fallback);
        Self {
            start: start.max(0.0),
            end: end.max(start),
        }
    }

    fn span(&self) -> Span {
        Span {
            start: self.start,
            end: self.end,
        }
    }
}

fn ui_number(ui: &std::collections::HashMap<String, Value>, key: &str) -> Option<f64> {
    ui.get(key).and_then(Value::as_f64)
}

/// Build a [`ToolOptions`] from a peer's numeric option map, keeping only the keys the
/// engine accepts (display-only toggles never reach it).
fn options_from_value(value: &Value) -> ToolOptions {
    let Some(object) = value.as_object() else {
        return ToolOptions::default();
    };
    let mut engine: Map<String, Value> = object
        .iter()
        .filter(|(key, _)| canonical_option_key(key).is_some())
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    crate::audio::analysis::compare::align::coerce_option_numbers(&mut engine);
    serde_json::from_value(Value::Object(engine)).unwrap_or_default()
}
