import { createEffect, createRoot } from "solid-js";
import type { SerializedDockview } from "dockview";
import { deepClone } from "../lib/clone";
import type { Note } from "../bindings/Note";
import { applySharedParams, sharedParams, type SharedParamsDto } from "./analysis";
import { setToolOptions, toolOptions } from "./analyzer";
import { filterEnabled, graphLayout, loadGraph, setFilterEnabled, type GraphLayout } from "./graph";
import { setWindowEnd, setWindowStart, windowEnd, windowStart } from "./timeline";
import { focusedNoteId, notes, replaceNotes, setFocusedNoteId } from "./notes";
import { layoutJson, openTools, restoreLayout, type ToolId } from "./workbench";

/**
 * App-level undo / redo (Backlog: "Undo / redo").
 *
 * A **snapshot-based** history: each step captures the whole editable project as
 * plain serializable data, so a restore just replays the state through the stores'
 * existing `loadGraph` / `applySharedParams` / `setToolOptions` / `restoreLayout`
 * helpers (the same ones `state/project/` uses on load). Continuous edits (param
 * drags, timeline scrubbing) are debounced so one gesture becomes one step.
 *
 * The undo stack's **top is always the current state**; undo therefore needs
 * more than one entry. Undo pops the current state onto the redo stack and restores
 * the new top; redo does the reverse. While a snapshot is being applied the capture
 * effect is muted (`applying`), so the restore is not recorded as a new edit.
 *
 * Deliberately excludes view settings (theme, font scale) — they are not project
 * state. Restoring state marks the project dirty (`state/project/` observes the
 * same stores), which is the correct behaviour for an undo.
 */

type ToolOptionsState = Record<string, Record<string, number>>;

/** The complete editable project state captured per history step. */
interface Snapshot {
  filter: GraphLayout;
  synth: GraphLayout;
  filterEnabled: boolean;
  shared: SharedParamsDto;
  toolOptions: ToolOptionsState;
  windowStart: number;
  windowEnd: number;
  layout: SerializedDockview | null;
  openTools: ToolId[];
  notes: Note[];
  focusedNoteId: string | null;
}

/** ~one gesture per step (matches the filter push's cooperative debounce). */
const DEBOUNCE_MS = 350;
/** Bound the history so a long session cannot grow without limit. */
const MAX_HISTORY = 100;

/** Read the whole editable project as a detached, serializable snapshot. */
function capture(): Snapshot {
  return deepClone({
    filter: graphLayout("filter"),
    synth: graphLayout("synth"),
    filterEnabled: filterEnabled(),
    shared: sharedParams(),
    toolOptions,
    windowStart: windowStart(),
    windowEnd: windowEnd(),
    layout: layoutJson(),
    openTools: openTools(),
    notes: notes(),
    focusedNoteId: focusedNoteId(),
  });
}

/** Replay a snapshot through the stores' existing restore helpers. */
function apply(snapshot: Snapshot) {
  // Apply a copy: `setToolOptions` / `loadGraph` adopt the objects they are handed,
  // so a later edit would otherwise mutate the snapshot stored for redo.
  const snap = deepClone(snapshot);
  loadGraph("filter", snap.filter);
  loadGraph("synth", snap.synth);
  setFilterEnabled(snap.filterEnabled);
  applySharedParams(snap.shared);
  setToolOptions(snap.toolOptions);
  setWindowStart(snap.windowStart);
  setWindowEnd(snap.windowEnd);
  replaceNotes(snap.notes);
  setFocusedNoteId(snap.focusedNoteId);
  restoreLayout(snap.layout);
}

// --- stacks ------------------------------------------------------------------

let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];

/** True while a snapshot is being restored (mutes the capture effect). */
let applying = false;

let debounceTimer: number | undefined;
let pending: Snapshot | undefined;
let reapplyTimer: number | undefined;

/** Record a state change as one undo step (unless it repeats the current top). */
function commit(snapshot: Snapshot) {
  if (applying) return;
  const top = undoStack[undoStack.length - 1];
  if (top && JSON.stringify(top) === JSON.stringify(snapshot)) return;
  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

/** Debounce continuous edits so a drag / scrub coalesces into a single step. */
function schedule(snapshot: Snapshot) {
  pending = snapshot;
  if (debounceTimer != undefined) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = undefined;
    const snapshot = pending;
    pending = undefined;
    if (snapshot) commit(snapshot);
  }, DEBOUNCE_MS);
}

/** Restore a snapshot without recording the restore itself as an edit. */
function restore(snapshot: Snapshot) {
  applying = true;
  if (debounceTimer != undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  pending = undefined;
  apply(snapshot);
  // Re-arm once Solid has flushed the effect triggered by the restore (mirrors the
  // project store's baseline handling).
  if (reapplyTimer != undefined) clearTimeout(reapplyTimer);
  reapplyTimer = window.setTimeout(() => {
    reapplyTimer = undefined;
    applying = false;
  }, 0);
}

// --- public API --------------------------------------------------------------

/** Step back one edit, if there is one. No-op on an empty stack. */
export function undo() {
  if (applying || undoStack.length < 2) return;
  const current = undoStack.pop();
  if (!current) return;
  redoStack.push(current);
  restore(undoStack[undoStack.length - 1]);
}

/** Step forward one undone edit, if there is one. No-op on an empty stack. */
export function redo() {
  if (applying || redoStack.length === 0) return;
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(next);
  restore(next);
}

/**
 * Drop all history and seed the fresh (post New/Open) state as the base step.
 * Called by `state/project/` after a load or New Project, so undo cannot step
 * back across a project boundary.
 */
export function resetHistory() {
  applying = true;
  if (debounceTimer != undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  pending = undefined;
  undoStack = [];
  redoStack = [];
  // Re-arm once Solid has flushed the store restores, then seed the base state.
  if (reapplyTimer != undefined) clearTimeout(reapplyTimer);
  reapplyTimer = window.setTimeout(() => {
    reapplyTimer = undefined;
    applying = false;
    undoStack = [capture()];
  }, 0);
}

// Capture every change to the tracked stores; the initial run seeds the base state.
createRoot(() => {
  createEffect(() => {
    const snapshot = capture();
    if (applying) return;
    schedule(snapshot);
  });
});
