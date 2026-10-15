import { createEffect, createRoot, createSignal } from "solid-js";
import type { Note } from "../../bindings/Note";
import { analyzerBus } from "../chartSync";
import { notesPanelOpen } from "../settings";

export const [notes, setNotes] = createSignal<Note[]>([]);
export const [focusedNoteId, setFocusedNoteId] = createSignal<string | null>(null);
/** The note whose inline editor is open (panel-level, so create can open it). */
export const [editingNoteId, setEditingNoteId] = createSignal<string | null>(null);

// Publish to the shared chart bus whenever the notes, the focus or the panel change.
createRoot(() => {
  createEffect(() => {
    analyzerBus.setData("notes", {
      notes: notes(),
      focusedId: focusedNoteId(),
      panelOpen: notesPanelOpen(),
    });
  });

  // The **focused** note is a panel concept: with the rail closed there is no row to
  // highlight and no label to read, so drop the focus. That also clears every chart's
  // full-height overlay and the Timeline's focused stem; the lane anchors stay behind,
  // drawn dull (see `analyzer/notePlugins.ts` and `timeline/draw.ts`).
  createEffect(() => {
    if (!notesPanelOpen()) setFocusedNoteId(null);
  });
});
