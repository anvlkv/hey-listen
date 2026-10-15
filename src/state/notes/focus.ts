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

/** The focused analyzer tab, for the panel's "Add note" default tool. */
export function defaultNoteTool(): AnalyzerId | null {
  return focusedAnalyzer();
}
