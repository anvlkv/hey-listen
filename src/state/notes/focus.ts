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
 * Select a note from the UI **without** touching the analysis window: highlight it and
 * open (or raise) the chart it belongs to. Used when a note is *created*, so writing an
 * annotation never reframes the analysis the user is looking at.
 * See `docs/notes.md` → Surfacing.
 */
export function selectNote(id: string | null) {
  setFocusedNoteId(id);
  const note = noteById(id);
  if (note?.tool && isAnalyzerId(note.tool)) void openTool(note.tool);
}

/**
 * Focus a note from the UI: [`selectNote`], **and** move the analysis window onto the
 * note's time (or its span). This is the "focus follows the click" rule the panel's row
 * and the lane use — a click is a request to look at that moment.
 */
export function focusNote(id: string | null) {
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
