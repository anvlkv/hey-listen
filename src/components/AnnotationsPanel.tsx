import { createSignal, For, Show, type JSX } from "solid-js";
import Button from "./Button";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import {
  createAnnotation,
  defaultAnnotationTool,
  annotationsSorted,
  openAnnotationWindow,
} from "../state/annotations";
import { setAnnotationsPanelOpen } from "../state/settings";
import { windowStart } from "../state/timeline";
import { AnnotationRow } from "./annotations/AnnotationRow";

/**
 * The **Annotations panel** (M14) — a right rail (a fixed region, not a Workbench tab)
 * listing the project's annotations. There is no separate title field: an annotation's
 * heading is the **first line** of its markdown body (and is not repeated in the
 * rendered body below it). A row is a **title bar** (heading + the row actions), its
 * tool + time, the **current** values line (with the frozen snapshot struck through
 * when it differs), and the rendered body clamped to a height. Selecting the heading
 * selects the annotation. See `docs/annotations.md`.
 *
 * **Adding** — `Add` drops a **point** annotation at the analysis window's start; a **range**
 * is drawn where the audio is, by dragging a span in the annotation lane of the Timeline or of
 * any time chart (`components/annotations/lane.ts`), and its edges are then draggable there.
 *
 * The per-annotation expand state lives here keyed by annotation id and is passed to the row as an
 * **accessor** — a store edit replaces the annotation object and its `<For>` row is
 * recreated, and a plain value read inside the `<For>` mapper would not be reactive.
 */
export default function AnnotationsPanel(props: { style?: JSX.CSSProperties }) {
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});

  const add = () => createAnnotation({ timeSecs: windowStart(), tool: defaultAnnotationTool() });

  return (
    <aside class="app-annotations" data-testid="region.annotations" style={props.style}>
      <div class="annotations-header">
        <span class="annotations-title">Annotations</span>
        <span class="annotations-count" data-testid="annotations.count">
          {annotationsSorted().length}
        </span>
        <div class="annotations-header-actions">
          <Tooltip label="Add an annotation at the analysis window">
            <Button
              class="annotation-icon"
              data-testid="annotations.add"
              aria-label="Add annotation"
              onClick={add}
            >
              <Icon name="plus" />
            </Button>
          </Tooltip>
          <Tooltip label="Collapse the annotations panel">
            <Button
              class="annotation-icon"
              data-testid="annotations.collapse"
              aria-label="Collapse the annotations panel"
              onClick={() => setAnnotationsPanelOpen(false)}
            >
              <Icon name="angle-right" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <ScrollArea class="annotations-scroll">
        <Show
          when={annotationsSorted().length > 0}
          fallback={
            <div class="annotations-empty" data-testid="annotations.empty">
              No annotations yet. Add one with <strong>+</strong> at the analysis window, drag a
              span in the Timeline's annotation lane to mark a range, or right-click a chart and
              choose “Add annotation here”.
            </div>
          }
        >
          <div class="annotations-rows" data-testid="annotations.rows">
            <For each={annotationsSorted()}>
              {(annotation) => (
                <AnnotationRow
                  annotation={annotation}
                  expanded={() => !!expanded()[annotation.id]}
                  onToggleExpand={() =>
                    setExpanded((map) => ({ ...map, [annotation.id]: !map[annotation.id] }))
                  }
                  onPopout={() => void openAnnotationWindow(annotation.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </ScrollArea>
    </aside>
  );
}
