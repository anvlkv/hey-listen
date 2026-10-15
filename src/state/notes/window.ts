import { invoke } from "../../lib/ipc";

/**
 * Open a note in its own **window** (M14).
 *
 * Like an analyzer popout (ADR-11), the note window is a *view* of the same project,
 * not a project of its own: the core creates the window and aliases it to the calling
 * window's project state, and the frontend renders just that note's editor. A note
 * that already has a window is **raised** rather than opened twice, the same rule the
 * analyzer tabs follow. See `docs/notes.md` → The Notes panel.
 */
export async function openNoteWindow(noteId: string): Promise<void> {
  try {
    await invoke("open_note_window", { noteId });
  } catch (err) {
    console.error("could not open the note window", err);
  }
}
