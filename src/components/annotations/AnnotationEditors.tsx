import { createSignal, onMount, untrack, type JSX } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import type { Annotation } from "../../bindings/Annotation";
import { updateAnnotation } from "../../state/annotations";

/**
 * The inline markdown editor for one annotation (M14).
 *
 * It **replaces** the row's rendered body while it is open (see `AnnotationRow`), so the
 * annotation is never shown twice, and it commits **explicitly** — blur is not a save. The
 * annotation's heading is the first line of the body, so the textarea holds the whole
 * markdown and the row's title bar updates when the edit is saved. See `docs/annotations.md`
 * → Markdown.
 */
export function AnnotationEditor(props: {
  annotation: Annotation;
  onClose: () => void;
}): JSX.Element {
  // One-shot seed: the draft is an edit buffer, not a live view of the annotation.
  const [draft, setDraft] = createSignal(untrack(() => props.annotation.body));
  let field: HTMLTextAreaElement | undefined;

  onMount(() => {
    if (!field) return;
    field.focus();
    // Editing an existing annotation: put the caret at the end rather than selecting all.
    field.setSelectionRange(field.value.length, field.value.length);
  });

  /** Save the draft (and re-snapshot the chart values at the annotation's time). */
  const commit = () => {
    updateAnnotation(props.annotation.id, { title: null, body: draft(), recomputeValues: true });
    props.onClose();
  };

  return (
    <div class="annotation-editor">
      <textarea
        ref={(el) => {
          field = el;
        }}
        class="annotation-textarea"
        data-testid={`annotation.bodyInput.${props.annotation.id}`}
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
      <div class="annotation-editor-actions">
        <Button
          class="annotation-icon"
          title="Discard the edit (Esc)"
          data-testid={`annotation.cancel.${props.annotation.id}`}
          aria-label="Discard the edit"
          onClick={() => props.onClose()}
        >
          <Icon name="xmark" />
        </Button>
        <Button
          class="annotation-icon annotation-icon-primary"
          title="Save the annotation (⌘/Ctrl+Enter)"
          data-testid={`annotation.done.${props.annotation.id}`}
          aria-label="Save the annotation"
          onClick={commit}
        >
          <Icon name="check" />
        </Button>
      </div>
    </div>
  );
}
