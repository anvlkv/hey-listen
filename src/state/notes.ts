import { createEffect, createRoot, createSignal } from "solid-js";
import type { AnalysisWindow } from "../bindings/AnalysisWindow";
import type { Note } from "../bindings/Note";
import type { NoteValues } from "../bindings/NoteValues";
import {
  analyzerById,
  formatHz,
  isAnalyzerId,
  latestResult,
  toolOptions,
  type AnalyzerId,
  type AnyAnalysisResult,
  type MatrixResult,
  type MatrixView as MatrixViewConfig,
  type RhythmResult,
  type SeriesResult,
  type SeriesView as SeriesViewConfig,
  type SpectrogramResult,
  type SpectrumResult,
  type WaveformResult,
  type LevelsResult,
  type LufsResult,
  type LraResult,
} from "./analyzer";
import { sharedParams } from "./analysis";
import { analyzerBus } from "./chartSync";
import { clampNoteRange, clampNoteTime } from "../lib/note";
import { setNotesPanelOpen } from "./settings";
import { source } from "./source";
import { setWindowEnd, setWindowStart, windowEnd, windowStart } from "./timeline";
import { focusedAnalyzer, openTool } from "./workbench";

/**
 * The notes store (M14) — the project's annotation layer (see `docs/notes.md`).
 *
 * A note is plain **data** (project content): a markdown body anchored to a time
 * (+ optional range) and, optionally, to an analyzer tool id, carrying a **frozen**
 * `values` snapshot of that chart's readout. The store owns create/update/delete/
 * focus and the values capture; persistence rides `save_project` / `load_project`
 * and cross-window sync rides `uiState` (ADR-11/ADR-18).
 *
 * The store also publishes its state on the shared chart bus (`notes`), so a chart's
 * note plugin can draw its own notes and the one focused note.
 */

export const [notes, setNotes] = createSignal<Note[]>([]);
export const [focusedNoteId, setFocusedNoteId] = createSignal<string | null>(null);
/** The note whose inline editor is open (panel-level, so create can open it). */
export const [editingNoteId, setEditingNoteId] = createSignal<string | null>(null);

// Publish to the shared chart bus whenever the notes or the focus change.
createRoot(() => {
  createEffect(() => {
    analyzerBus.setData("notes", { notes: notes(), focusedId: focusedNoteId() });
  });
});

// --- reads -------------------------------------------------------------------

/** One note by id, or `null`. */
export function noteById(id: string | null): Note | null {
  if (!id) return null;
  return notes().find((note) => note.id === id) ?? null;
}

/** The focused note, or `null`. */
export function focusedNote(): Note | null {
  return noteById(focusedNoteId());
}

/** The notes sorted by anchor time. */
export function notesSorted(): Note[] {
  return [...notes()].sort((a, b) => a.timeSecs - b.timeSecs);
}

/** The notes a chart draws (those whose `tool` matches), sorted by time. */
export function notesForTool(tool: AnalyzerId): Note[] {
  return notesSorted().filter((note) => note.tool === tool);
}

// --- mutations ---------------------------------------------------------------

export interface NoteInput {
  timeSecs: number;
  range?: AnalysisWindow | null;
  tool?: AnalyzerId | null;
  title?: string | null;
  body?: string;
  /** Focus the new note (default true). */
  focus?: boolean;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `note-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Normalise an incoming note: validate the tool, clamp the time/range. */
function normalize(note: Note): Note {
  const duration = source()?.duration ?? 0;
  const tool = note.tool && isAnalyzerId(note.tool) ? note.tool : null;
  return {
    ...note,
    timeSecs: clampNoteTime(note.timeSecs, duration),
    range: note.range ? clampNoteRange(note.range, duration) : null,
    tool,
  };
}

/** Create a note (capturing its values snapshot) and focus it. */
export function createNote(input: NoteInput): Note {
  const now = Date.now();
  const tool = input.tool && isAnalyzerId(input.tool) ? input.tool : null;
  const note = normalize({
    id: newId(),
    createdMs: now,
    updatedMs: now,
    timeSecs: input.timeSecs,
    range: input.range ?? null,
    tool,
    title: input.title ?? null,
    body: input.body ?? "",
    values: null,
  });
  note.values = tool ? captureValues(tool, note.timeSecs, now) : null;
  setNotes((prev) => [...prev, note]);
  if (input.focus ?? true) {
    // Creating reveals the rail (if collapsed), opens the new note's editor, and
    // focuses it.
    setNotesPanelOpen(true);
    setEditingNoteId(note.id);
    focusNote(note.id);
  }
  return note;
}

export interface NotePatch {
  title?: string | null;
  body?: string;
  timeSecs?: number;
  range?: AnalysisWindow | null;
  tool?: AnalyzerId | null;
  recomputeValues?: boolean;
}

/** Patch a note's editable fields (and optionally refresh its values snapshot). */
export function updateNote(id: string, patch: NotePatch): Note | null {
  let updated: Note | null = null;
  setNotes((prev) =>
    prev.map((note) => {
      if (note.id !== id) return note;
      const next = normalize({
        ...note,
        title: "title" in patch ? (patch.title ?? null) : note.title,
        body: patch.body ?? note.body,
        timeSecs: patch.timeSecs ?? note.timeSecs,
        range: "range" in patch ? (patch.range ?? null) : note.range,
        tool: "tool" in patch ? (patch.tool ?? null) : (note.tool as AnalyzerId | null),
      });
      next.updatedMs = Date.now();
      if (patch.recomputeValues && next.tool && isAnalyzerId(next.tool)) {
        next.values = captureValues(next.tool, next.timeSecs, Date.now());
      }
      updated = next;
      return next;
    }),
  );
  return updated;
}

/** Remove a note; clearing the focus/editing if it was this note. */
export function deleteNote(id: string) {
  setNotes((prev) => prev.filter((note) => note.id !== id));
  if (focusedNoteId() === id) setFocusedNoteId(null);
  if (editingNoteId() === id) setEditingNoteId(null);
}

/** Re-snapshot a note's frozen values from the live chart. */
export function refreshNoteValues(id: string) {
  updateNote(id, { recomputeValues: true });
}

/**
 * Live drag of a note's anchor time (clamped to the source). Call
 * [`refreshNoteValues`] on release to re-snapshot the values at the new time.
 */
export function dragNoteTo(id: string, timeSecs: number) {
  const duration = source()?.duration ?? 0;
  updateNote(id, { timeSecs: clampNoteTime(timeSecs, duration) });
}

/** Replace the whole list (load / undo / cross-window sync), pruning stale selections. */
export function replaceNotes(list: Note[]) {
  const normalized = list.map(normalize);
  setNotes(normalized);
  const focused = focusedNoteId();
  if (focused && !normalized.some((note) => note.id === focused)) setFocusedNoteId(null);
  const editing = editingNoteId();
  if (editing && !normalized.some((note) => note.id === editing)) setEditingNoteId(null);
}

/** Drop every note and the focus (New Project). */
export function resetNotes() {
  setNotes([]);
  setFocusedNoteId(null);
  setEditingNoteId(null);
}

// --- focus -------------------------------------------------------------------

/** Set the focus without side effects (cross-window sync + the MCP tool). */
export function setFocusedNote(id: string | null) {
  setFocusedNoteId(id);
}

/**
 * Focus a note from the UI: highlight it, **open/raise its chart**, and move the
 * analysis window to its time (or its span). See `docs/notes.md` → Surfacing.
 */
export function focusNote(id: string | null) {
  setFocusedNoteId(id);
  const note = noteById(id);
  if (!note) return;
  if (note.tool && isAnalyzerId(note.tool)) void openTool(note.tool);
  applyNoteWindow(note);
}

/** Move the analysis window onto a note (its span, or a window starting at its time). */
function applyNoteWindow(note: Note) {
  const duration = source()?.duration ?? 0;
  if (note.range) {
    setWindowStart(note.range.startSecs);
    setWindowEnd(note.range.endSecs);
    return;
  }
  const width = windowEnd() - windowStart();
  const start = clampNoteTime(note.timeSecs, duration);
  const fallback = duration > 0 ? Math.max(0.05, duration * 0.1) : 0;
  const end = duration > 0 ? Math.min(duration, start + (width > 0 ? width : fallback)) : start;
  setWindowStart(start);
  setWindowEnd(Math.max(end, start));
}

// --- values capture ----------------------------------------------------------

/** The frozen snapshot for a tool's chart at `timeSecs`, or `null` without a result. */
export function captureValues(
  tool: AnalyzerId,
  timeSecs: number,
  capturedMs: number,
): NoteValues | null {
  const result = latestResult(tool);
  if (!result) return null;
  return noteValuesFor({
    tool,
    result,
    timeSecs,
    window: { startSecs: windowStart(), endSecs: windowEnd() },
    params: sharedParams(),
    options: { ...toolOptions[tool] },
    capturedMs,
  });
}

/** Build a `NoteValues` snapshot from a live result (the readout at the note's time). */
export function noteValuesFor(args: {
  tool: AnalyzerId;
  result: AnyAnalysisResult;
  timeSecs: number;
  window: AnalysisWindow;
  params: NoteValues["params"];
  options: Record<string, number>;
  capturedMs: number;
}): NoteValues {
  const def = analyzerById(args.tool);
  return {
    tool: args.tool,
    label: `${def.title} @ ${args.timeSecs.toFixed(3)} s`,
    text: valuesText(def.id, args.result, args.timeSecs),
    window: args.window,
    params: args.params,
    options: args.options,
    capturedMs: args.capturedMs,
  };
}

/** The frozen snapshot's **current** readout (live from the chart), or `null`. */
export function liveValues(note: Note): NoteValues | null {
  if (!note.tool || !isAnalyzerId(note.tool)) return null;
  const tool = note.tool;
  const result = latestResult(tool);
  if (!result) return null;
  return noteValuesFor({
    tool,
    result,
    timeSecs: note.timeSecs,
    window: { startSecs: windowStart(), endSecs: windowEnd() },
    params: sharedParams(),
    options: { ...toolOptions[tool] },
    capturedMs: note.values?.capturedMs ?? Date.now(),
  });
}

/** True when the live readout's **values line** differs from the frozen snapshot. */
export function noteValuesStale(note: Note): boolean {
  if (!note.values) return false;
  const live = liveValues(note);
  return live != null && live.text !== note.values.text;
}

// --- per-tool readout formatting ---------------------------------------------

const db = (value: number) => 20 * Math.log10(Math.max(Math.abs(value), 1e-6));

/** The frame nearest a time on a uniformly-sampled axis. */
function frameIndex(timeSecs: number, duration: number, count: number): number {
  if (!(duration > 0) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((timeSecs / duration) * count)));
}

/** The index nearest `time` in an irregular time axis. */
function nearestIndex(times: number[], timeSecs: number): number {
  if (times.length === 0) return 0;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < times.length; i++) {
    const distance = Math.abs(times[i] - timeSecs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** The nearest index at or around `index` whose value is present (not a gap). */
function presentIndex(values: (number | null)[], index: number): number | null {
  for (let offset = 0; offset < values.length; offset++) {
    const right = index + offset;
    if (right < values.length && values[right] != null) return right;
    const left = index - offset;
    if (left >= 0 && values[left] != null) return left;
  }
  return null;
}

/** The compact values line for a tool's result at a time (the note's subtitle). */
function valuesText(tool: AnalyzerId, result: AnyAnalysisResult, timeSecs: number): string {
  const t = timeSecs.toFixed(3);
  switch (result.tool) {
    case "waveform": {
      const r = result as WaveformResult;
      const frame = frameIndex(timeSecs, r.duration, r.max.length);
      if (r.max.length === 0) return `t ${t} s · no data`;
      const peak = Math.max(Math.abs(r.max[frame]), Math.abs(r.min[frame]));
      return `t ${t} s · peak ${db(peak).toFixed(1)} dBFS`;
    }
    case "spectrum": {
      const r = result as SpectrumResult;
      return `peak ${formatHz(r.peakHz)} · ${r.peakDb.toFixed(1)} dB`;
    }
    case "spectrogram": {
      const r = result as SpectrogramResult;
      if (r.frames === 0 || r.bins === 0) return `t ${t} s · no data`;
      const frame = Math.min(r.frames - 1, frameIndex(timeSecs, r.duration, r.frames));
      const base = frame * r.bins;
      let bin = 0;
      let best = -Infinity;
      for (let b = 0; b < r.bins; b++) {
        const value = r.magDb[base + b];
        if (value > best) {
          best = value;
          bin = b;
        }
      }
      return `t ${t} s · peak ${best.toFixed(1)} dB @ ${formatHz(r.freqs[bin] ?? 0)}`;
    }
    case "levels": {
      const r = result as LevelsResult;
      return `peak ${r.peakDb.toFixed(1)} dBFS · RMS ${r.rmsDb.toFixed(1)} dBFS`;
    }
    case "loudnessIntegrated":
      return `${(result as LufsResult).lufs.toFixed(1)} LUFS`;
    case "loudnessRange":
      return `${(result as LraResult).lra.toFixed(1)} LU`;
    case "tempo":
    case "onsets":
    case "downbeats": {
      const r = result as RhythmResult;
      const index = nearestIndex(r.times, timeSecs);
      const strength = r.onsetStrength[index];
      return strength == null
        ? `t ${t} s · no onset`
        : `t ${t} s · onset strength ${strength.toFixed(4)}`;
    }
    default:
      break;
  }

  if ("times" in result) {
    const r = result as SeriesResult;
    const view = analyzerById(tool).view as SeriesViewConfig;
    const index = presentIndex(r.values, nearestIndex(r.times, timeSecs));
    if (index == null) return `t ${t} s · no value`;
    return `t ${t} s · ${view.yLabel} ${view.formatY(r.values[index]!)}`;
  }
  if ("bins" in result) {
    const r = result as MatrixResult;
    if (r.frames === 0 || r.bins === 0) return `t ${t} s · no data`;
    const view = analyzerById(tool).view as MatrixViewConfig;
    const frame = Math.min(r.frames - 1, frameIndex(timeSecs, r.duration, r.frames));
    const base = frame * r.bins;
    let band = 0;
    let best = -Infinity;
    for (let b = 0; b < r.bins; b++) {
      const value = r.values[base + b];
      if (value > best) {
        best = value;
        band = b;
      }
    }
    return `t ${t} s · ${view.yLabel} ${view.formatBand(band)}: ${view.formatValue(best)}`;
  }
  return `t ${t} s`;
}

/** The focused analyzer tab, for the panel's "Add note" default tool. */
export function defaultNoteTool(): AnalyzerId | null {
  return focusedAnalyzer();
}
