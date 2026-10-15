import { createSignal, onMount, untrack, type JSX } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import type { Note } from "../../bindings/Note";
import { updateNote } from "../../state/notes";

/**
 * The inline markdown editor for one note (M14).
 *
 * It **replaces** the row's rendered body while it is open (see `NoteRow`), so the
 * note is never shown twice, and it commits **explicitly** — blur is not a save. The
 * note's heading is the first line of the body, so the textarea holds the whole
 * markdown and the row's title bar updates when the edit is saved. See `docs/notes.md`
 * → Markdown.
 */
export function NoteEditor(props: { note: Note; onClose: () => void }): JSX.Element {
  // One-shot seed: the draft is an edit buffer, not a live view of the note.
  const [draft, setDraft] = createSignal(untrack(() => props.note.body));
  let field: HTMLTextAreaElement | undefined;

  onMount(() => {
    if (!field) return;
    field.focus();
    // Editing an existing note: put the caret at the end rather than selecting all.
    field.setSelectionRange(field.value.length, field.value.length);
  });

  /** Save the draft (and re-snapshot the chart values at the note's time). */
  const commit = () => {
    updateNote(props.note.id, { title: null, body: draft(), recomputeValues: true });
    props.onClose();
  };

  return (
    <div class="note-editor">
      <textarea
        ref={(el) => {
          field = el;
        }}
        class="note-textarea"
        data-testid={`note.bodyInput.${props.note.id}`}
        placeholder="Write markdown — the first line is the title"
        value={draft()}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Explicit save / discard, so a stray click can never lose an edit.
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
        }}
      />
      <div class="note-editor-actions">
        <Button
          class="note-icon"
          title="Discard the edit (Esc)"
          data-testid={`note.cancel.${props.note.id}`}
          aria-label="Discard the edit"
          onClick={() => props.onClose()}
        >
          <Icon name="xmark" />
        </Button>
        <Button
          class="note-icon note-icon-primary"
          title="Save the note (⌘/Ctrl+Enter)"
          data-testid={`note.done.${props.note.id}`}
          aria-label="Save the note"
          onClick={commit}
        >
          <Icon name="check" />
        </Button>
      </div>
    </div>
  );
}
