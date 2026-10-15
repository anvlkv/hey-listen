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
 * note plugin can draw its own notes, the one focused note, and whether the rail is open.
 *
 * **Select vs. analyze.** Selecting a note ([`selectNote`]) only highlights it and opens
 * its chart; only [`analyzeNote`] (the row's Analyze button) moves the analysis window.
 *
 * This module is the package's public surface — it re-exports the store's API, so
 * importers need no changes. The parts live in focused siblings: `types` (input
 * shapes), `signals` (the store signals + bus publish), `reads` (queries),
 * `mutations` (create/update/delete/patch), `focus` (selection/analyze), `values`
 * (frozen readout snapshots) and `format` (the per-tool readout line).
 */
export { editingNoteId, focusedNoteId, notes, setEditingNoteId, setFocusedNoteId } from "./signals";
export { noteById, notesSorted } from "./reads";
export {
  createNote,
  deleteNote,
  dragNoteEndTo,
  dragNoteTo,
  refreshNoteValues,
  replaceNotes,
  resetNotes,
  updateNote,
} from "./mutations";
export { analyzeNote, defaultNoteTool, selectNote, setFocusedNote } from "./focus";
export { liveValues, noteValuesStale } from "./values";
export { openNoteWindow } from "./window";
export type { NotePatch } from "./types";
