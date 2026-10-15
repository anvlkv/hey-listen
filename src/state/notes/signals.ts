import { createEffect, createRoot, createSignal } from "solid-js";
import type { Note } from "../../bindings/Note";
import { analyzerBus } from "../chartSync";

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
