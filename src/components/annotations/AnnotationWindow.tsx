import { createSignal, onMount, Show, untrack, type JSX } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import type { Annotation } from "../../bindings/Annotation";
import { invoke } from "../../lib/ipc";
import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { annotationById, updateAnnotation } from "../../state/annotations";
import { annotationTimeText } from "../../lib/annotation";

/**
 * The content of an annotation's own window (M14): a large, **edit-only** editor for one annotation.
 *
 * Like an analyzer popout, this is a *view* of the project (ADR-11): the annotation data
 * arrives through the shared `uiState` sync — the window waits for it before mounting
 * (see `PopoutApp`), not through a dedicated command. The draft is an edit buffer seeded
 * once from the body; **Done** or ⌘/Ctrl+Enter commits it (re-snapshotting the chart
 * values), Escape closes without saving. See `docs/annotations.md`.
 */
export default function AnnotationWindow(props: { annotationId: string }): JSX.Element {
  const annotation = () => annotationById(props.annotationId);
  // One-shot seed: the draft is an edit buffer, not a live view of the annotation.
  const [draft, setDraft] = createSignal(untrack(annotation)?.body ?? "");
  let field: HTMLTextAreaElement | undefined;

  onMount(() => {
    if (!field) return;
    field.focus();
    // Put the caret at the end rather than selecting all.
    field.setSelectionRange(field.value.length, field.value.length);
  });

  /** Close this window — the app routes closes through the Rust command (see `menu.ts`). */
  const close = () => void invoke("close_window").catch(() => {});

  /** Save the draft (and re-snapshot the chart values at the annotation's time), then close. */
  const commit = () => {
    updateAnnotation(props.annotationId, { title: null, body: draft(), recomputeValues: true });
    close();
  };

  return (
    <div class="annotation-window" data-testid="annotations.window">
      <Show
        when={annotation()}
        fallback={<div class="annotations-empty">This annotation was deleted.</div>}
      >
        {(current) => (
          <>
            <div class="annotation-popout-header">
              <span class="annotation-popout-title">
                {toolTitle(current())} · {annotationTimeText(current())}
              </span>
              <Button class="annotation-icon" aria-label="Close" onClick={close}>
                <Icon name="xmark" />
              </Button>
            </div>
            <textarea
              ref={(el) => {
                field = el;
              }}
              class="annotation-popout-textarea"
              data-testid="annotations.window.body"
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
            <div class="annotation-editor-actions">
              <Button
                class="annotations-btn"
                data-testid="annotations.window.done"
                onClick={commit}
              >
                Done
              </Button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

/** The heading's tool label: the analyzer's title, or "Timeline" for an unanchored annotation. */
function toolTitle(annotation: Annotation): string {
  return annotation.tool && isAnalyzerId(annotation.tool)
    ? analyzerById(annotation.tool).title
    : "Timeline";
}
