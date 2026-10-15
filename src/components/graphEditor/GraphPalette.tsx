import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Panel } from "@dschz/solid-flow";
import { nodeKind, paletteFor, type GraphKind, type NodeKindDef } from "../../lib/graph";
import { addNode } from "../../state/graph";
import { resolvedTheme } from "../../state/themes";
import Icon from "../Icon";
import ScrollArea from "../ScrollArea";
import Tooltip from "../Tooltip";

/** How far (px) the pointer must move before a palette press becomes a drag. */
const DRAG_THRESHOLD = 4;

/** Inline styling for the palette search box, matched to the active theme. */
const SEARCH_STYLE_DARK: JSX.CSSProperties = {
  width: "100%",
  "box-sizing": "border-box",
  height: "24px",
  padding: "0 8px 0 26px",
  font: "inherit",
  "font-size": "11px",
  color: "#e6e6e6",
  background: "#1f1f1f",
  border: "1px solid #3c3c3c",
  "border-radius": "4px",
};

const SEARCH_STYLE_LIGHT: JSX.CSSProperties = {
  ...SEARCH_STYLE_DARK,
  color: "#1f2328",
  background: "#ffffff",
  border: "1px solid #d8dce2",
};

/** The palette search-box inline theme for the active [`resolvedTheme`] (reactive). */
const searchStyle = () => (resolvedTheme() === "light" ? SEARCH_STYLE_LIGHT : SEARCH_STYLE_DARK);

/** Props for [`GraphPalette`]; `canAdd` is shared with the editor's drop handler. */
type GraphPaletteProps = {
  graph: GraphKind;
  canAdd: (def: NodeKindDef) => boolean;
  onDrop: (def: NodeKindDef, clientX: number, clientY: number) => void;
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
  /** The in-progress palette drag (pointer-based), or `null` when idle. */
  let paletteDrag: { kind: string; startX: number; startY: number; moved: boolean } | null = null;
  /** Set after a drag so the originating palette button's `click` is ignored. */
  let suppressClick = false;

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
    paletteDrag = { kind: def.kind, startX: event.clientX, startY: event.clientY, moved: false };
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
      props.onDraggingChange(drag.kind);
    }
    event.preventDefault();
  }

  function stopPaletteDrag() {
    window.removeEventListener("pointermove", onPalettePointerMove, true);
    window.removeEventListener("pointerup", onPalettePointerUp, true);
    window.removeEventListener("pointercancel", onPalettePointerCancel, true);
  }

  function onPalettePointerUp(event: PointerEvent) {
    const drag = paletteDrag;
    paletteDrag = null;
    stopPaletteDrag();
    props.onDraggingChange(null);
    if (!drag || !drag.moved) return; // a click — the button's `onClick` adds it
    suppressClick = true;
    const def = nodeKind(drag.kind);
    if (!def) return;
    props.onDrop(def, event.clientX, event.clientY);
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
            aria-label={collapsed() ? "Expand node palette" : "Collapse node palette"}
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
            style={searchStyle()}
          />
        </div>
        <ScrollArea class="graph-palette-scroll">
          <For each={groups()}>
            {(group) => (
              <div class="graph-palette-group">
                <div class="graph-palette-title">{group.category}</div>
                <div class="graph-palette-buttons">
                  <For each={group.kinds}>
                    {(def) => (
                      <Show when={props.canAdd(def)}>
                        <Tooltip
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
                            <Icon name="plus" /> {def.label}
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
