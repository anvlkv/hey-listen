//! Cross-project comparison commands (M25).
//!
//! The core owns the compute: A comes from the caller's window, B from the reference
//! label's **live** project state (own PCM, own filter) or from A's **saved snapshot**
//! (M25.C). The frontend supplies each side's window/params/options (B's through
//! [`compare_peer_setup`]), and this module only adapts state + IPC. Nothing here writes
//! to either project.
//!
//! Split into focused siblings: `peer` (the reference's setup/state/targets) and
//! `popout` (the native compare window); this module owns the compute request.

use serde::Deserialize;
use serde_json::Value;
use tauri::{Manager, WebviewWindow};

use crate::audio::analysis::compare::{
    self, CompareSetup, SavedComparison, SavedComparisonInfo, SideInput,
};
use crate::audio::analysis::{Axis, Shape};
use crate::audio::analyzers::AnalyzerId;
use crate::state::{window_state, WindowState};

pub mod peer;
pub mod popout;
pub mod reference;

use peer::{peer_state, project_name, project_path, self_comparison_error};

/// The comparison a caller selected: `id` names one saved pair, falling back to the newest
/// one for the tool when it is absent or has no snapshot yet. Several comparisons may
/// share a tool, so the id is what selects a pair.
pub(super) fn selected_snapshot(
    state: &WindowState,
    tool: AnalyzerId,
    id: Option<&str>,
) -> Result<SavedComparison, String> {
    state
        .saved_comparison_selected(tool, id)
        .ok_or_else(|| match id.filter(|id| !id.is_empty()) {
            Some(id) => format!("no saved comparison '{id}' for '{tool}'"),
            None => {
                format!("no saved comparison for '{tool}' — pick a live reference project first")
            }
        })
}

/// One `run_comparison` request: the comparison id, the tool, the reference project
/// label **or** the owner's saved snapshot, both setups, and how much of each
/// result/delta to return.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRequest {
    /// The comparison's stable id: the live tab's id, which its saved snapshot is stored
    /// under. Empty means "keep the pair's existing id, or mint one"; for `saved` it
    /// selects that pair (falling back to the newest for `tool` when empty or unknown).
    #[serde(default)]
    pub id: String,
    pub tool: AnalyzerId,
    /// The reference project's window label (a live comparison).
    #[serde(default)]
    pub reference: Option<String>,
    /// Use the owner's saved reference snapshot instead of a live project (M25.C).
    #[serde(default)]
    pub saved: bool,
    pub a: CompareSetup,
    /// B's setup; required for a live comparison, ignored for a saved one.
    #[serde(default)]
    pub b: Option<CompareSetup>,
    /// The fine-tune offset δ in seconds: positive moves the reference **later** on the
    /// relative axis (M25.B). A live reference defaults to `0`; a saved reference defaults
    /// to the snapshot's stored offset (M25.C).
    #[serde(default)]
    pub b_offset: Option<f64>,
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
/// never lazily create an empty state. A **saved** comparison (M25.C) runs only A and
/// diffs against the stored reference snapshot; either way the last successful result
/// is recorded in the owner's state (what a save writes).
#[tauri::command]
pub async fn run_comparison(
    window: WebviewWindow,
    request: CompareRequest,
) -> Result<Value, String> {
    let app = window.app_handle().clone();
    let a_state = window_state(&window);
    let a_project = project_name(&a_state);

    tauri::async_runtime::spawn_blocking(move || {
        let CompareRequest {
            id,
            tool,
            reference,
            saved,
            a,
            b,
            b_offset,
            shape,
            max_points,
            compact_axis,
        } = request;
        let owner = a;
        let a = SideInput {
            project: a_project,
            state: &a_state,
            setup: owner.clone(),
        };

        let (comparison, mut snapshot) = if saved {
            let stored = selected_snapshot(&a_state, tool, Some(&id))?;
            let b_offset = b_offset.unwrap_or(stored.b_offset);
            let comparison = compare::compare_saved(tool, a, &stored, b_offset)
                .map_err(|err| err.to_string())?;
            // The stored result is untouched; only the display offset may have moved.
            let mut snapshot = stored;
            snapshot.b_offset = b_offset;
            (comparison, snapshot)
        } else {
            let b_offset = b_offset.unwrap_or(0.0);
            let reference = reference
                .ok_or_else(|| "`reference` is required for a live comparison".to_string())?;
            let b_setup = b.ok_or_else(|| "`b` (the reference setup) is required".to_string())?;
            let b_state = peer_state(&app, &reference)?;
            // The live reference resolved to the same project state as A: a
            // self-comparison reports a perfect match, so refuse it (M25).
            if std::sync::Arc::ptr_eq(&a_state, &b_state) {
                return Err(self_comparison_error(&reference));
            }
            let b_project = project_name(&b_state);
            let b_path = project_path(&b_state);
            let b_filter = compare::filter_fingerprint(&b_state);
            // Capture the reference's window audio before `b_setup` moves into `SideInput`.
            let audio = compare::ReferenceAudio::from_state(&b_state, b_setup.span());
            let comparison = compare::compare(
                tool,
                a,
                SideInput {
                    project: b_project,
                    state: &b_state,
                    setup: b_setup,
                },
                b_offset,
            )
            .map_err(|err| err.to_string())?;
            let snapshot = compare::SavedComparison::from_side(
                tool,
                id.clone(),
                &owner,
                &comparison.b,
                b_filter,
                b_offset,
                crate::recent::now_ms(),
                b_path,
                audio,
            );
            (comparison, snapshot)
        };

        // The view's id is the stored entry's id: the tab passes its own, and an id-less
        // caller keeps the id of the pair it already compared (one entry per pair) or
        // gets a fresh one. A saved pair retargeted into a view is re-keyed to it, so the
        // open tab is exactly what a save writes.
        snapshot.id = a_state.pin_comparison_id(&id, &snapshot);
        a_state.store_saved_comparison(snapshot.clone());
        let axis = if compact_axis.unwrap_or(false) {
            Axis::Compact
        } else {
            Axis::Array
        };
        let mut value = comparison.to_value(shape, max_points, axis);
        value["id"] = Value::String(snapshot.id.clone());
        value["savedFingerprint"] = Value::String(snapshot.fingerprint());
        Ok(value)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// The owner's saved comparison snapshots (several per tool), for the picker and MCP.
#[tauri::command]
pub fn compare_saved(window: WebviewWindow, tool: Option<AnalyzerId>) -> Vec<SavedComparisonInfo> {
    let infos = window_state(&window).saved_comparison_infos();
    match tool {
        Some(tool) => infos.into_iter().filter(|info| info.tool == tool).collect(),
        None => infos,
    }
}

/// Forget every saved comparison (a new project starts without one, M25.C).
#[tauri::command]
pub fn clear_compare_saved(window: WebviewWindow) {
    window_state(&window).clear_saved_comparisons();
}
