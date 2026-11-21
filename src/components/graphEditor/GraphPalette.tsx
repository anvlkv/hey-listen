import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Panel } from "@dschz/solid-flow";
import { paletteFor, type GraphKind, type NodeKindDef } from "../../lib/graph";
import { addNode } from "../../state/graph";
import Icon from "../Icon";
import ScrollArea from "../ScrollArea";
import Tooltip from "../Tooltip";

/** How far (px) the pointer must move before a palette press becomes a drag. */
const DRAG_THRESHOLD = 4;

/** Props for [`GraphPalette`]; `canAdd` is shared with the editor's drop handler. */
type GraphPaletteProps = {
  graph: GraphKind;
  canAdd: (def: NodeKindDef) => boolean;
  onDrop: (def: NodeKindDef, clientX: number, clientY: number) => void;
  /** The pointer moved during a palette drag, so the editor can show where it lands. */
  onDragMove: (def: NodeKindDef, clientX: number, clientY: number) => void;
  onDraggingChange: (kind: string | null) => void;
};

/**
 * The node palette overlay for the graph editor: a collapsible, searchable list of
 * the kinds available for `graph`, added by click or dragged onto the canvas.
 *
 * Palette drag-and-drop is **pointer-based**, not HTML5 drag-and-drop. Tauri's
 * native file-drop handler consumes every drag over the webview on macOS (so an
 * HTML5 `drop` never fires) and raises its file-drop overlay mid-drag — see
 * `state/dragdrop.ts`. Driving the drag with pointer events keeps the two apart:
 * files still drop through Tauri, palette nodes through these handlers.
 *
 * A press that moves past [`DRAG_THRESHOLD`] before release is a drag; a press
 * released in place is a click (the button's `onClick` adds the node).
 */
export default function GraphPalette(props: GraphPaletteProps): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [collapsed, setCollapsed] = createSignal(false);
  /** A palette press/drag is active; node tooltips are forced shut while it is. */
  const [dragging, setDragging] = createSignal(false);
  /** The in-progress palette drag (pointer-based), or `null` when idle. */
  let paletteDrag: {
    def: NodeKindDef;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  /** Set after a drag so the originating palette button's `click` is ignored. */
  let suppressClick = false;
  /**
   * The element holding the pointer capture. Without it a release outside the webview
   * never reaches the window listeners and the drag (and its ghost) stays live.
   */
  let captured: { element: Element; pointerId: number } | null = null;

  /** The palette, filtered by the search box (matches label or kind name). */
  const groups = () => {
    const needle = query().trim().toLowerCase();
    return paletteFor(props.graph)
      .map((group) => ({
        ...group,
        kinds: needle
          ? group.kinds.filter(
              (def) =>
                def.label.toLowerCase().includes(needle) || def.kind.toLowerCase().includes(needle),
            )
          : group.kinds,
      }))
      .filter((group) => group.kinds.length > 0);
  };

  function onPalettePointerDown(def: NodeKindDef, event: PointerEvent) {
    if (event.button !== 0) return;
    suppressClick = false;
    setDragging(true);
    paletteDrag = { def, startX: event.clientX, startY: event.clientY, moved: false };
    // Capture the pointer so a release outside the palette (or the window) still ends
    // the drag instead of leaving it live.
    const element = event.currentTarget;
    if (element instanceof Element) {
      element.setPointerCapture(event.pointerId);
      captured = { element, pointerId: event.pointerId };
    }
    // Capture phase: solid-flow's pane also listens for pointer events, and a capture
    // listener on `window` runs first regardless of what the canvas does with them.
    window.addEventListener("pointermove", onPalettePointerMove, true);
    window.addEventListener("pointerup", onPalettePointerUp, true);
    window.addEventListener("pointercancel", onPalettePointerCancel, true);
  }

  function onPalettePointerMove(event: PointerEvent) {
    const drag = paletteDrag;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD)
        return;
      drag.moved = true;
      props.onDraggingChange(drag.def.kind);
    }
    props.onDragMove(drag.def, event.clientX, event.clientY);
    event.preventDefault();
  }

  function stopPaletteDrag() {
    setDragging(false);
    window.removeEventListener("pointermove", onPalettePointerMove, true);
    window.removeEventListener("pointerup", onPalettePointerUp, true);
    window.removeEventListener("pointercancel", onPalettePointerCancel, true);
    if (captured) {
      try {
        captured.element.releasePointerCapture(captured.pointerId);
      } catch {
        // Already released (the pointer was cancelled): nothing to hand back.
      }
      captured = null;
    }
  }

  function onPalettePointerUp(event: PointerEvent) {
    const drag = paletteDrag;
    paletteDrag = null;
    stopPaletteDrag();
    props.onDraggingChange(null);
    if (!drag || !drag.moved) return; // a click — the button's `onClick` adds it
    suppressClick = true;
    props.onDrop(drag.def, event.clientX, event.clientY);
  }

  function onPalettePointerCancel() {
    paletteDrag = null;
    stopPaletteDrag();
    props.onDraggingChange(null);
  }

  onCleanup(stopPaletteDrag);

  return (
    <Panel
      position="top-left"
      class="graph-palette"
      style={{ "max-height": "calc(100% - 16px)", overflow: "hidden" }}
    >
      <div class="graph-palette-head">
        <Tooltip
          label={collapsed() ? "Expand the node palette" : "Collapse the node palette"}
          class="tooltip-grow"
        >
          <button
            type="button"
            class="graph-palette-toggle icon-btn"
            aria-expanded={!collapsed()}
            aria-label={collapsed() ? "Nodes — expand palette" : "Nodes — collapse palette"}
            onClick={() => setCollapsed(!collapsed())}
          >
            <Icon name={collapsed() ? "angle-right" : "angle-down"} />
            Nodes
          </button>
        </Tooltip>
      </div>
      <Show when={!collapsed()}>
        <div class="graph-palette-search-wrap">
          <Icon name="magnifying-glass" class="graph-palette-search-icon" />
          <input
            type="text"
            class="graph-palette-search nodrag nopan"
            placeholder="Search nodes…"
            aria-label="Search nodes"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <ScrollArea class="graph-palette-scroll" resetKey={query()}>
          <For each={groups()}>
            {(group) => (
              <div class="graph-palette-group">
                <div class="graph-palette-title">{group.category}</div>
                <div class="graph-palette-buttons">
                  <For each={group.kinds}>
                    {(def) => (
                      <Show when={props.canAdd(def)}>
                        <Tooltip
                          disabled={dragging()}
                          placement="right"
                          label={
                            def.hint
                              ? `${def.label} — ${def.hint}. Click to add, or drag onto the canvas.`
                              : `Add ${def.label}`
                          }
                        >
                          <button
                            type="button"
                            class="graph-palette-btn"
                            data-testid="graph.palette.btn"
                            on:pointerdown={(event) => onPalettePointerDown(def, event)}
                            onClick={(event) => {
                              // A drag that ended over the canvas still fires a `click` on
                              // the source button in some WebViews — ignore it.
                              if (suppressClick) {
                                suppressClick = false;
                                event.preventDefault();
                                return;
                              }
                              addNode(props.graph, def);
                            }}
                          >
                            {def.label}
                          </button>
                        </Tooltip>
                      </Show>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
          <Show when={groups().length === 0}>
            <div class="graph-palette-title">No matching nodes</div>
          </Show>
        </ScrollArea>
      </Show>
    </Panel>
  );
}
