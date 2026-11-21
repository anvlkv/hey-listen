import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import Icon from "../Icon";
import { DROP_NODE_HEIGHT, DROP_NODE_WIDTH } from "./placement";

/** Everything the palette drag overlay needs, resolved by `GraphEditor`. */
export interface DragPreviewState {
  label: string;
  /** Pointer position, client coordinates (the ghost follows it). */
  ghost: { x: number; y: number };
  valid: boolean;
  /** Why the drop is refused (shown on the ghost), or null when it would land. */
  hint: string | null;
  /** Where the node will land, in canvas-local pixels. */
  position: { x: number; y: number } | null;
  /** The connector to splice into (null = a plain placement). */
  splice: boolean;
  /** The highlighted connector, already in canvas-local coordinates. */
  splicePath: string | null;
}

/**
 * The palette drag affordance (M22): a ghost under the pointer, a translucent outline
 * where the node will land, and — over a connector — the highlighted link plus an
 * *Insert into link* badge. An invalid drop (outside the canvas, or a second anchor)
 * reads as not-allowed with a hint.
 *
 * Rendered inside `.graph-canvas` so the drop preview and connector highlight share its
 * coordinate space; the ghost is portaled to `<body>` so it is never clipped.
 */
export default function DragPreview(props: { state: DragPreviewState | null }) {
  return (
    <Show when={props.state}>
      {(state) => (
        <>
          <Show when={state().valid && state().position}>
            {(position) => (
              <div
                class="graph-drop-preview"
                data-testid="graph.drop.preview"
                style={{
                  left: `${position().x}px`,
                  top: `${position().y}px`,
                  width: `${DROP_NODE_WIDTH}px`,
                  height: `${DROP_NODE_HEIGHT}px`,
                }}
              />
            )}
          </Show>
          <Show when={state().splicePath}>
            {(path) => (
              <svg class="graph-splice-overlay" data-testid="graph.drop.splice.path">
                <path d={path()} />
              </svg>
            )}
          </Show>
          <Portal mount={document.body}>
            <div
              class="graph-drag-ghost"
              classList={{ "graph-drag-ghost-invalid": !state().valid }}
              data-testid="graph.drag.ghost"
              style={{
                left: `${state().ghost.x + 14}px`,
                top: `${state().ghost.y + 14}px`,
              }}
            >
              <Icon name="plus" />
              <span>{state().label}</span>
              <Show when={!state().valid}>
                <span class="graph-drag-hint" data-testid="graph.drop.hint">
                  {state().hint}
                </span>
              </Show>
              <Show when={state().valid && state().splice}>
                <span
                  class="graph-drag-hint graph-drag-hint-splice"
                  data-testid="graph.drop.splice"
                >
                  Insert into link
                </span>
              </Show>
            </div>
          </Portal>
        </>
      )}
    </Show>
  );
}
