import { createEffect, createResource, createSignal, on, Show, untrack, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import Button from "../Button";
import Icon from "../Icon";
import type { Note } from "../../bindings/Note";
import { updateNote } from "../../state/notes";
import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { noteBody, noteTimeText } from "../../lib/note";
import { renderMarkdown } from "../../lib/markdown";

/** The inline markdown editor: textarea ↔ rendered preview on focus loss. */
export function NoteEditor(props: {
  note: Note;
  preview: () => boolean;
  onPreview: (on: boolean) => void;
  onDone: () => void;
}): JSX.Element {
  // One-shot seed: the draft is the edit buffer, not a live view of the note.
  const [draft, setDraft] = createSignal(untrack(() => props.note.body));
  const [html] = createResource(
    () => (props.preview() ? noteBody(draft()) : null),
    (text) => renderMarkdown(text),
  );

  const commit = () =>
    updateNote(props.note.id, { title: null, body: draft(), recomputeValues: true });

  return (
    <div class="note-editor">
      <Show
        when={props.preview()}
        fallback={
          <textarea
            class="note-textarea"
            data-testid={`note.bodyInput.${props.note.id}`}
            placeholder="Write markdown… (the first line is the title)"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onBlur={() => {
              commit();
              props.onPreview(true);
            }}
          />
        }
      >
        <div
          class="note-preview markdown-body"
          data-testid={`note.preview.${props.note.id}`}
          title="Click to keep editing"
          onClick={() => props.onPreview(false)}
          // The HTML is `renderMarkdown` output (marked + DOMPurify sanitized).
          // eslint-disable-next-line solid/no-innerhtml -- sanitized, not raw note text
          innerHTML={html() || "<p><em>Nothing below the title</em></p>"}
        />
      </Show>
      <div class="note-editor-actions">
        <Button
          class="notes-btn"
          data-testid={`note.done.${props.note.id}`}
          onClick={() => {
            commit();
            props.onDone();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

/** The popped-out editor: a large, edit-only overlay (M14). */
export function NoteEditorWindow(props: { note: Note; onClose: () => void }): JSX.Element {
  // Seeded once; the effect below re-seeds it when the popout is switched to another
  // note.
  const [draft, setDraft] = createSignal(untrack(() => props.note.body));

  // Re-seed the draft if the popout is switched to another note.
  createEffect(
    on(
      () => props.note.id,
      () => setDraft(props.note.body),
    ),
  );

  const tool = () => {
    const id = props.note.tool;
    return id && isAnalyzerId(id) ? analyzerById(id).title : "Timeline";
  };

  const commit = () =>
    updateNote(props.note.id, { title: null, body: draft(), recomputeValues: true });

  const close = () => {
    commit();
    props.onClose();
  };

  return (
    <Portal>
      <div class="note-popout-scrim" onClick={close}>
        <div
          class="note-popout"
          data-testid="notes.popout"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="note-popout-header">
            <span class="note-popout-title">
              {tool()} · {noteTimeText(props.note)}
            </span>
            <Button class="note-icon" aria-label="Close the editor" onClick={close}>
              <Icon name="xmark" />
            </Button>
          </div>
          <textarea
            class="note-popout-textarea"
            data-testid="notes.popout.body"
            placeholder="Write markdown… (the first line is the title)"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <div class="note-editor-actions">
            <Button class="notes-btn" data-testid="notes.popout.done" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
