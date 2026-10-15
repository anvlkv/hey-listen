import type { Note } from "../../bindings/Note";
import { isAnalyzerId, type AnalyzerId } from "../analyzer";
import {
  clampNoteRange,
  clampNoteRangeEnd,
  clampNoteRangeStart,
  clampNoteTime,
  noteSpan,
} from "../../lib/note";
import { setNotesPanelOpen } from "../settings";
import { source } from "../source";
import { focusNote } from "./focus";
import { noteById } from "./reads";
import {
  editingNoteId,
  focusedNoteId,
  setEditingNoteId,
  setFocusedNoteId,
  setNotes,
} from "./signals";
import type { NoteInput, NotePatch } from "./types";
import { captureValues } from "./values";

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
 * Live drag of a note's **start** edge (clamped to the source), along the time axis.
 *
 * A point note moves; a range note **resizes** — its start follows the pointer and its
 * end stays put (the selection semantics the strip's two handles imply). Call
 * [`refreshNoteValues`] on release to re-snapshot the values at the new start.
 */
export function dragNoteTo(id: string, timeSecs: number) {
  const duration = source()?.duration ?? 0;
  const note = noteById(id);
  if (!note) return;
  const range = note.range;
  if (!range) {
    updateNote(id, { timeSecs: clampNoteTime(timeSecs, duration) });
    return;
  }
  const start = clampNoteRangeStart(clampNoteTime(timeSecs, duration), range.endSecs);
  updateNote(id, { timeSecs: start, range: { startSecs: start, endSecs: range.endSecs } });
}

/**
 * Live drag of a range's **end** edge, clamped to the source (the span never
 * collapses). A point note grows a range from its anchor, which is how a range is
 * made by dragging. Call [`refreshNoteValues`] on release.
 */
export function dragNoteEndTo(id: string, timeSecs: number) {
  const duration = source()?.duration ?? 0;
  const note = noteById(id);
  if (!note) return;
  const start = noteSpan(note).start;
  const end = clampNoteRangeEnd(start, timeSecs, duration);
  updateNote(id, { range: { startSecs: start, endSecs: end } });
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
