import { createMemo, createResource, Show, type JSX } from "solid-js";
import Button from "../Button";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import type { Annotation } from "../../bindings/Annotation";
import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { VIEW_ICONS } from "../../lib/icons";
import {
  analyzeAnnotation,
  deleteAnnotation,
  editingAnnotationId,
  selectedAnnotationId,
  liveValues,
  annotationValuesStale,
  selectAnnotation,
  setEditingAnnotationId,
} from "../../state/annotations";
import { annotationBody, annotationHeading, annotationTimeText } from "../../lib/annotation";
import { renderMarkdown } from "../../lib/markdown";
import { AnnotationEditor } from "./AnnotationEditors";

/**
 * One annotation: the title bar (heading + actions), meta, values, and the body.
 *
 * The heading and the chart action only **select** the annotation (highlight + open its
 * chart); moving the analysis window onto the annotation is the explicit **Analyze** action,
 * so browsing the rail never re-frames the analysis (see `state/annotations/select.ts`).
 *
 * While the annotation is being edited the editor **replaces** the rendered body (the row
 * shows the annotation once, not twice), and a commit is explicit — see [`AnnotationEditor`]. The
 * values line stays visible while editing: it is the frozen snapshot being annotated,
 * so hiding it would hide the very thing the annotation is about.
 * The expand/preview state arrives as accessors: a store edit replaces the annotation object
 * and its row is recreated, so a plain value read here would not be reactive.
 */
export function AnnotationRow(props: {
  annotation: Annotation;
  expanded: () => boolean;
  onToggleExpand: () => void;
  onPopout: () => void;
}): JSX.Element {
  const selected = () => selectedAnnotationId() === props.annotation.id;
  const editing = () => editingAnnotationId() === props.annotation.id;

  const def = () => {
    const tool = props.annotation.tool;
    return tool && isAnalyzerId(tool) ? analyzerById(tool) : null;
  };
  const toolTitle = () => def()?.title ?? "Timeline";

  // Current values (live) with the frozen snapshot struck through when it differs.
  const live = createMemo(() => liveValues(props.annotation));
  const stale = createMemo(() => annotationValuesStale(props.annotation));
  const currentText = () => live()?.text ?? props.annotation.values?.text ?? null;
  const oldText = () => (stale() ? (props.annotation.values?.text ?? null) : null);

  return (
    <div
      class="annotation-row"
      classList={{ "annotation-row-selected": selected() }}
      data-testid={`annotation.row.${props.annotation.id}`}
    >
      <div class="annotation-titlebar">
        <button
          type="button"
          class="annotation-title"
          onClick={() => selectAnnotation(props.annotation.id)}
          title="Select this annotation"
          data-testid={`annotation.heading.${props.annotation.id}`}
        >
          {annotationHeading(props.annotation.body) || "Annotation"}
        </button>
        <div class="annotation-titlebar-actions">
          <Tooltip label={props.annotation.range ? "Analyze this span" : "Analyze this moment"}>
            <Button
              class="annotation-icon"
              data-testid={`annotation.analyze.${props.annotation.id}`}
              aria-label="Analyze this annotation"
              onClick={() => analyzeAnnotation(props.annotation.id)}
            >
              <Icon name="arrows-left-right-to-line" />
            </Button>
          </Tooltip>
          <Show when={def()}>
            {(tool) => (
              <Tooltip label={`Open the ${tool().title} chart`}>
                <Button
                  class="annotation-icon"
                  data-testid={`annotation.open.${props.annotation.id}`}
                  aria-label="Open the chart"
                  onClick={() => selectAnnotation(props.annotation.id)}
                >
                  <Icon name={VIEW_ICONS[tool().view.kind]} />
                </Button>
              </Tooltip>
            )}
          </Show>
          <Tooltip label="Edit">
            <Button
              class="annotation-icon"
              data-testid={`annotation.edit.${props.annotation.id}`}
              aria-label="Edit the annotation"
              onClick={() => setEditingAnnotationId(editing() ? null : props.annotation.id)}
            >
              <Icon name="pencil" />
            </Button>
          </Tooltip>
          <Tooltip label="Open the annotation in its own window">
            <Button
              class="annotation-icon"
              data-testid={`annotation.popout.${props.annotation.id}`}
              aria-label="Open the annotation in its own window"
              onClick={() => props.onPopout()}
            >
              <Icon name="arrow-up-right-from-square" />
            </Button>
          </Tooltip>
          <Tooltip label="Delete">
            <Button
              class="annotation-icon"
              data-testid={`annotation.delete.${props.annotation.id}`}
              aria-label="Delete the annotation"
              onClick={() => deleteAnnotation(props.annotation.id)}
            >
              <Icon name="trash" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div class="annotation-row-meta">
        {toolTitle()} · {annotationTimeText(props.annotation)}
      </div>

      <Show when={currentText()}>
        <div class="annotation-values">
          <span
            class="annotation-values-current"
            data-testid={`annotation.values.${props.annotation.id}`}
          >
            {currentText()}
          </span>
          <Show when={oldText()}>
            <span class="annotation-values-old">{oldText()}</span>
          </Show>
        </div>
      </Show>

      <Show
        when={editing()}
        fallback={
          <AnnotationBody
            body={props.annotation.body}
            id={props.annotation.id}
            expanded={props.expanded}
            onToggle={props.onToggleExpand}
          />
        }
      >
        <AnnotationEditor
          annotation={props.annotation}
          onClose={() => setEditingAnnotationId(null)}
        />
      </Show>
    </div>
  );
}

/** The rendered body (heading line removed), clamped to a height with a chevron. */
function AnnotationBody(props: {
  body: string;
  id: string;
  expanded: () => boolean;
  onToggle: () => void;
}): JSX.Element {
  const rest = () => annotationBody(props.body);
  const [html] = createResource(rest, (text) => renderMarkdown(text));
  const long = () =>
    rest()
      .split("\n")
      .filter((line) => line.trim().length > 0).length > 3;
  return (
    <Show when={rest().length > 0}>
      <div class="annotation-body-wrap">
        <div
          class="annotation-body markdown-body"
          classList={{ "annotation-body-clamped": !props.expanded() }}
          data-testid={`annotation.body.${props.id}`}
          // The HTML is `renderMarkdown` output (marked + DOMPurify sanitized).
          // eslint-disable-next-line solid/no-innerhtml -- sanitized, not raw annotation text
          innerHTML={html() ?? ""}
        />
        <Show when={long()}>
          <button
            type="button"
            class="annotation-body-toggle"
            aria-label={props.expanded() ? "Collapse the annotation" : "Expand the annotation"}
            onClick={() => props.onToggle()}
          >
            <Icon name={props.expanded() ? "chevron-up" : "chevron-down"} />
          </button>
        </Show>
      </div>
    </Show>
  );
}
