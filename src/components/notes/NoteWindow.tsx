import { createSignal, onMount, Show, untrack, type JSX } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import type { Note } from "../../bindings/Note";
import { invoke } from "../../lib/ipc";
import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { noteById, updateNote } from "../../state/notes";
import { noteTimeText } from "../../lib/note";

/**
 * The content of a note's own window (M14): a large, **edit-only** editor for one note.
 *
 * Like an analyzer popout, this is a *view* of the project (ADR-11): the note data
 * arrives through the shared `uiState` sync — the window waits for it before mounting
 * (see `PopoutApp`), not through a dedicated command. The draft is an edit buffer seeded
 * once from the body; **Done** or ⌘/Ctrl+Enter commits it (re-snapshotting the chart
 * values), Escape closes without saving. See `docs/notes.md`.
 */
export default function NoteWindow(props: { noteId: string }): JSX.Element {
  const note = () => noteById(props.noteId);
  // One-shot seed: the draft is an edit buffer, not a live view of the note.
  const [draft, setDraft] = createSignal(untrack(note)?.body ?? "");
  let field: HTMLTextAreaElement | undefined;

  onMount(() => {
    if (!field) return;
    field.focus();
    // Put the caret at the end rather than selecting all.
    field.setSelectionRange(field.value.length, field.value.length);
  });

  /** Close this window — the app routes closes through the Rust command (see `menu.ts`). */
  const close = () => void invoke("close_window").catch(() => {});

  /** Save the draft (and re-snapshot the chart values at the note's time), then close. */
  const commit = () => {
    updateNote(props.noteId, { title: null, body: draft(), recomputeValues: true });
    close();
  };

  return (
    <div class="note-window" data-testid="notes.window">
      <Show when={note()} fallback={<div class="notes-empty">This annotation was deleted.</div>}>
        {(current) => (
          <>
            <div class="note-popout-header">
              <span class="note-popout-title">
                {toolTitle(current())} · {noteTimeText(current())}
              </span>
              <Button class="note-icon" aria-label="Close" onClick={close}>
                <Icon name="xmark" />
              </Button>
            </div>
            <textarea
              ref={(el) => {
                field = el;
              }}
              class="note-popout-textarea"
              data-testid="notes.window.body"
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                // Explicit save / discard, so a stray click can never lose an edit.
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <div class="note-editor-actions">
              <Button class="notes-btn" data-testid="notes.window.done" onClick={commit}>
                Done
              </Button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

/** The heading's tool label: the analyzer's title, or "Timeline" for an unanchored note. */
function toolTitle(note: Note): string {
  return note.tool && isAnalyzerId(note.tool) ? analyzerById(note.tool).title : "Timeline";
}
