//! Cross-project comparison commands (M25) — see `docs/comparison.md`.
//!
//! The core owns the compute: A comes from the caller's window, B from the reference
//! label's **live** project state (own PCM, own filter). The frontend supplies each
//! side's window/params/options (B's through [`compare_peer_setup`]), and this module
//! only adapts state + IPC. Nothing here writes to either project.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::audio::analysis::compare::{self, CompareSetup, SourceShape, Span};
use crate::audio::analysis::{canonical_option_key, Axis, Shape, SharedParams, ToolOptions};
use crate::commands::window::{next_label, raise};
use crate::state::{window_state, CompareView, WindowRegistry, WindowState};

/// One `run_comparison` request: the tool, the reference project label, both setups,
/// and how much of each result/delta to return.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRequest {
    pub tool: String,
    /// The reference project's window label.
    pub reference: String,
    pub a: CompareSetup,
    pub b: CompareSetup,
    #[serde(default)]
    pub shape: Shape,
    #[serde(default)]
    pub max_points: Option<usize>,
    /// Spell a uniform `times` axis compactly (MCP/CLI callers).
    #[serde(default)]
    pub compact_axis: Option<bool>,
}

/// Run `tool` over both projects and return `{ a, b, comparability, diff }`.
///
/// Both runs execute on the blocking pool, sequentially. A missing/closed reference is
/// an error (the view renders the **Reference project closed** banner); peer reads
/// never lazily create an empty state.
#[tauri::command]
pub async fn run_comparison(
    window: WebviewWindow,
    request: CompareRequest,
) -> Result<Value, String> {
    let app = window.app_handle().clone();
    let a_state = window_state(&window);
    let b_state = peer_state(&app, &request.reference)?;
    let a_project = project_name(&a_state);
    let b_project = project_name(&b_state);

    tauri::async_runtime::spawn_blocking(move || {
        let comparison = compare::compare(
            &request.tool,
            compare::SideInput {
                project: a_project,
                state: &a_state,
                setup: request.a,
            },
            compare::SideInput {
                project: b_project,
                state: &b_state,
                setup: request.b,
            },
        )
        .map_err(|err| err.to_string())?;
        let axis = if request.compact_axis.unwrap_or(false) {
            Axis::Compact
        } else {
            Axis::Array
        };
        Ok(comparison.to_value(request.shape, request.max_points, axis))
    })
    .await
    .map_err(|err| err.to_string())?
}

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
    tool: String,
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
        .and_then(|value| value.get(&tool).cloned())
        .map(|value| options_from_value(&value))
        .unwrap_or_default();
    Ok(PeerSetup {
        project: project_name(&state),
        source: compare::source_shape(&state).ok(),
        window,
        options: crate::audio::analyzers::effective_options(&tool, Some(&options)),
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

// --- compare popouts --------------------------------------------------------

/// Open a compare popout for `tool`, or raise/retarget the one already open.
#[tauri::command]
pub async fn open_compare_popout(
    window: WebviewWindow,
    tool: String,
    reference: String,
) -> Result<(), String> {
    let app = window.app_handle();
    let registry = app.state::<WindowRegistry>();
    let parent = registry.root_label(window.label());
    peer_state(app, &reference)?;

    if let Some(existing) = registry.compare_popout_for(&parent, &tool) {
        if let Some(popout) = app.get_webview_window(&existing) {
            registry.retarget_compare_popout(&existing, &reference);
            raise(&popout);
            return Ok(());
        }
        registry.remove(&existing);
    }
    let view = CompareView {
        tool,
        with: reference,
    };
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

/// Retarget the **calling** compare popout at another reference project.
#[tauri::command]
pub fn retarget_compare_popout(window: WebviewWindow, reference: String) -> Result<(), String> {
    peer_state(window.app_handle(), &reference)?;
    window
        .app_handle()
        .state::<WindowRegistry>()
        .retarget_compare_popout(window.label(), &reference);
    Ok(())
}

/// The compare view a popout shows, or `None` for any other window.
#[tauri::command]
pub fn popout_compare(window: WebviewWindow) -> Option<CompareView> {
    let registry = window.app_handle().state::<WindowRegistry>();
    registry.compare_popout(window.label())
}

/// The compare popouts of the calling project (for `get_state`; never saved).
#[tauri::command]
pub fn compare_popouts(window: WebviewWindow) -> Vec<CompareView> {
    let registry = window.app_handle().state::<WindowRegistry>();
    registry.compare_popouts_of(&registry.root_label(window.label()))
}

// --- helpers ----------------------------------------------------------------

/// The live project state for `reference`, following a popout alias to its project.
/// A closed reference is an error — this never creates an empty state (ADR-24).
fn peer_state(app: &AppHandle, reference: &str) -> Result<Arc<WindowState>, String> {
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

/// Resolve a reference label from any command that has no `AppHandle` (the popout
/// queries and the live poll run in the calling window).
fn project_name(state: &WindowState) -> Option<String> {
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
