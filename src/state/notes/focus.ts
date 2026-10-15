import type { Note } from "../../bindings/Note";
import { isAnalyzerId, type AnalyzerId } from "../analyzer";
import { clampNoteTime } from "../../lib/note";
import { source } from "../source";
import { setWindowEnd, setWindowStart, windowEnd, windowStart } from "../timeline";
import { focusedAnalyzer, openTool } from "../workbench";
import { noteById } from "./reads";
import { setFocusedNoteId } from "./signals";

/** Set the focus without side effects (cross-window sync + the MCP tool). */
export function setFocusedNote(id: string | null) {
  setFocusedNoteId(id);
}

/**
 * Select a note from the UI: highlight it and open (or raise) the chart it belongs to.
 *
 * Selecting **never** moves the analysis window — a note is an annotation *on* the
 * analysis, so neither creating one nor clicking one is a request to reframe. Moving
 * the window onto a note is the explicit [`analyzeNote`] action (the row's **Analyze**
 * button). See `docs/notes.md` → Surfacing.
 */
export function selectNote(id: string | null) {
  setFocusedNoteId(id);
  const note = noteById(id);
  if (note?.tool && isAnalyzerId(note.tool)) void openTool(note.tool);
}

/**
 * The **only** action that moves the analysis window onto a note: the row's Analyze
 * button. A range note becomes the window exactly; a point note gets a window of the
 * current width (or a tenth of the source) starting at its time.
 */
export function analyzeNote(id: string | null) {
  selectNote(id);
  const note = noteById(id);
  if (!note) return;
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

/** The focused analyzer tab, for the panel's "Add note" default tool. */
export function defaultNoteTool(): AnalyzerId | null {
  return focusedAnalyzer();
}
