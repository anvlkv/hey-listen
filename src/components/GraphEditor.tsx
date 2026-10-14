import "@dschz/solid-flow/styles";
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  SolidFlow,
  useSolidFlow,
  type NodeTypes,
} from "@dschz/solid-flow";
import { handlePort, nodeKind, paletteFor, type GraphKind, type NodeKindDef } from "../lib/graph";
import { bezierPoints, distanceToPolyline, type Point } from "../lib/graphEdges";
import {
  addNode,
  addNodeAt,
  clearGraphWarning,
  graphFor,
  hasKind,
  isAnchorKind,
  setNodesPosition,
  spliceEdge,
  warnGraph,
  type GraphEdge,
} from "../state/graph";
import { resolvedTheme, themeFlow } from "../state/themes";
import GraphNode from "./GraphNode";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";

const nodeTypes = { graph: GraphNode } satisfies NodeTypes;

/** Half a node's nominal size, so a dropped node is centred on the cursor. */
const NODE_HALF_WIDTH = 70;
const NODE_HALF_HEIGHT = 27;
/** How close (in flow units) a drop must land to a connector to splice in. */
const SPLICE_RADIUS = 26;
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

/** Flow canvas theme matched to the app palette (belt-and-braces with `colorMode`).
 *  Its baseline (`--xy-*`) now lives in `state/themes.ts` as the base flow for the
 *  active theme's `base`; a theme's `flow` overlay is merged on top by [`themeFlow`]. */

/** The flow canvas inline theme for the active theme (reactive). */
const flowStyle = () => themeFlow() as JSX.CSSProperties;
/** The palette search-box inline theme for the active [`resolvedTheme`] (reactive). */
const searchStyle = () => (resolvedTheme() === "light" ? SEARCH_STYLE_LIGHT : SEARCH_STYLE_DARK);

/** The `solid-flow` instance API, as read from inside the flow's context. */
type FlowApi = ReturnType<typeof useSolidFlow>;

/**
 * Captures the flow instance from *inside* `<SolidFlow>` (the only place the flow
 * context exists) and hands it to the editor body. Needed for `screenToFlowPosition`
 * and handle geometry in the drop-to-insert gesture. Renders nothing.
 */
function FlowBridge(props: { ready: (api: FlowApi) => void }) {
  const api = useSolidFlow();
  onMount(() => props.ready(api));
  return null;
}

/** Whether `to` is reachable from `from` following existing edges. */
function reaches(graph: GraphKind, from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of graphFor(graph).edges) {
      if (edge.source === node) stack.push(edge.target);
    }
  }
  return false;
}

/**
 * Why a proposed connection is invalid, or `null` if it is fine.
 *
 * Mirrors the core's rules (`audio/graph.rs`): one source per input, no self-links,
 * no cycles.
 */
function connectionProblem(
  graph: GraphKind,
  source: string,
  target: string,
  targetHandle?: string | null,
): string | null {
  if (source === target) return "A node cannot connect to itself.";
  const port = handlePort(targetHandle);
  const occupied = graphFor(graph).edges.some(
    (edge) => edge.target === target && handlePort(edge.targetHandle) === port,
  );
  if (occupied) return "That input already has a connection — each input takes one source.";
  if (reaches(graph, target, source)) return "That connection would create a loop.";
  return null;
}

/** Add a new edge to our store unless the library already mirrored it (idempotent). */
function onConnected(
  graph: GraphKind,
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
) {
  clearGraphWarning();
  const handle = graphFor(graph);
  const exists = handle.edges.some(
    (edge) =>
      edge.id === id ||
      (edge.source === source &&
        edge.target === target &&
        handlePort(edge.sourceHandle) === handlePort(sourceHandle) &&
        handlePort(edge.targetHandle) === handlePort(targetHandle)),
  );
  if (!exists) {
    handle.setEdges((edges) => [
      ...edges,
      {
        id,
        source,
        target,
        sourceHandle: sourceHandle ?? undefined,
        targetHandle: targetHandle ?? undefined,
      },
    ]);
  }
}

/**
 * The shared fundsp graph editor (`solid-flow`), used by both the filter and synth
 * tabs. The graph's node/edge stores live in `state/graph.ts`, so switching or
 * closing the tab does not lose the graph.
 */
export default function GraphEditor(props: { graph: GraphKind; children?: JSX.Element }) {
  // The flow instance, captured via `FlowBridge` on mount (user gestures only fire
  // after that), so nothing reactive is lost by keeping it in a plain variable.
  let flow: FlowApi | undefined;
  let canvasEl!: HTMLDivElement;
  /** The in-progress palette drag (pointer-based), or `null` when idle. */
  let paletteDrag: { kind: string; startX: number; startY: number; moved: boolean } | null = null;
  /** Set after a drag so the originating palette button's `click` is ignored. */
  let suppressClick = false;

  const handle = () => graphFor(props.graph);
  const [query, setQuery] = createSignal("");
  const [collapsed, setCollapsed] = createSignal(false);
  /** The kind currently being dragged from the palette (`null` when idle). */
  const [dragging, setDragging] = createSignal<string | null>(null);

  const canAdd = (def: NodeKindDef) =>
    def.kind !== "input" && def.kind !== "output" ? true : !hasKind(props.graph, def.kind);

  /** The palette, filtered by the search box (matches label or kind name). */
  const groups = () => {
    const needle = query().trim().toLowerCase();
    return paletteFor(props.graph)
      .map((group) => ({
        ...group,
        kinds: needle
          ? group.kinds.filter(
              (def) =>
                def.label.toLowerCase().includes(needle) ||
                def.kind.toLowerCase().includes(needle),
            )
          : group.kinds,
      }))
      .filter((group) => group.kinds.length > 0);
  };

  /** The flow-coordinate centre of a handle, or null if the node isn't measured yet. */
  function handleCentre(
    nodeId: string,
    type: "source" | "target",
    handleId: string | null | undefined,
  ): Point | null {
    const internal = flow?.getInternalNode(nodeId);
    if (!internal) return null;
    const bounds =
      type === "source"
        ? internal.internals.handleBounds?.source
        : internal.internals.handleBounds?.target;
    const wanted = handleId ?? "0";
    const found = bounds?.find((candidate) => (candidate.id ?? "0") === wanted) ?? bounds?.[0];
    if (!found) return null;
    return {
      x: internal.internals.positionAbsolute.x + found.x + found.width / 2,
      y: internal.internals.positionAbsolute.y + found.y + found.height / 2,
    };
  }

  /** The connector nearest `point` (within [`SPLICE_RADIUS`]), or null. */
  function edgeNear(point: Point): GraphEdge | null {
    let best: GraphEdge | null = null;
    let bestDistance = SPLICE_RADIUS;
    for (const edge of handle().edges) {
      const source = handleCentre(edge.source, "source", edge.sourceHandle);
      const target = handleCentre(edge.target, "target", edge.targetHandle);
      if (!source || !target) continue;
      const distance = distanceToPolyline(point, bezierPoints(source, target));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = edge;
      }
    }
    return best;
  }

  /**
   * Whether `nodeId` can be spliced into `edge` — it must have both an input and an
   * output, neither port 0 may be taken, and the new `source → node → target` path
   * must not create a cycle.
   */
  function canSplice(def: NodeKindDef, nodeId: string, edge: GraphEdge): boolean {
    if (def.inputs < 1 || def.outputs < 1) return false;
    if (edge.source === nodeId || edge.target === nodeId) return false;
    const edges = handle().edges;
    const inletFree = !edges.some((e) => e.target === nodeId && handlePort(e.targetHandle) === 0);
    const outletFree = !edges.some((e) => e.source === nodeId && handlePort(e.sourceHandle) === 0);
    if (!inletFree || !outletFree) return false;
    if (reaches(props.graph, nodeId, edge.source)) return false;
    if (reaches(props.graph, edge.target, nodeId)) return false;
    return true;
  }

  /** Add `def` centred on `point`, splicing it into the nearest connector if any. */
  function placeNode(def: NodeKindDef, point: Point) {
    const node = addNodeAt(props.graph, def, {
      x: point.x - NODE_HALF_WIDTH,
      y: point.y - NODE_HALF_HEIGHT,
    });
    const edge = edgeNear(point);
    if (edge && canSplice(def, node.id, edge)) spliceEdge(props.graph, edge, node.id);
  }

  /**
   * Palette drag-and-drop is **pointer-based**, not HTML5 drag-and-drop. Tauri's
   * native file-drop handler consumes every drag over the webview on macOS (so an
   * HTML5 `drop` never fires) and raises its file-drop overlay mid-drag — see
   * `state/dragdrop.ts`. Driving the drag with pointer events keeps the two apart:
   * files still drop through Tauri, palette nodes through these handlers.
   *
   * A press that moves past [`DRAG_THRESHOLD`] before release is a drag; a press
   * released in place is a click (the button's `onClick` adds the node).
   */
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
      setDragging(drag.kind);
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
    setDragging(null);
    if (!drag || !drag.moved) return; // a click — the button's `onClick` adds it
    suppressClick = true;
    const def = nodeKind(drag.kind);
    const rect = canvasEl?.getBoundingClientRect();
    if (!def || !flow || !rect) return;
    const overCanvas =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!overCanvas || !canAdd(def)) return;
    clearGraphWarning();
    placeNode(def, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }

  function onPalettePointerCancel() {
    paletteDrag = null;
    stopPaletteDrag();
    setDragging(null);
  }

  onCleanup(stopPaletteDrag);

  return (
    <div class="graph-editor">
      <div class="graph-toolbar">{props.children}</div>
      <div
        ref={canvasEl}
        class="graph-canvas"
        classList={{ "graph-canvas-dragging": dragging() !== null }}
        data-testid="graph.canvas"
      >
        <SolidFlow
          id={`graph-${props.graph}`}
          nodes={handle().nodes}
          edges={handle().edges}
          nodeTypes={nodeTypes}
          colorMode={resolvedTheme()}
          style={flowStyle()}
          fitView
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          isValidConnection={(connection) => {
            const problem = connectionProblem(
              props.graph,
              connection.source,
              connection.target,
              connection.targetHandle,
            );
            if (problem) {
              warnGraph(problem);
              return false;
            }
            return true;
          }}
          onConnect={(connection) =>
            onConnected(
              props.graph,
              connection.id,
              connection.source,
              connection.target,
              connection.sourceHandle,
              connection.targetHandle,
            )
          }
          onDelete={({ nodes, edges }) => {
            // Mirror deletions (idempotent — the library may already have done it).
            // Input/Output anchors are undeletable (`deletable: false`); skip them
            // anyway so a stray event can never remove an anchor.
            if (edges.length) {
              const ids = new Set(edges.map((edge) => edge.id));
              handle().setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
            }
            if (nodes.length) {
              const ids = new Set(
                nodes
                  .filter((node) => !isAnchorKind(node.data.kind))
                  .map((node) => node.id),
              );
              handle().setNodes((current) => current.filter((node) => !ids.has(node.id)));
            }
          }}
          onNodeDragStop={({ targetNode }) => {
            if (!targetNode) return;
            setNodesPosition(props.graph, targetNode.id, { ...targetNode.position });
            // Dropping an existing node onto a connector splices it in (splitting the
            // edge), matching the palette drag-and-drop behaviour.
            const def = nodeKind(targetNode.data.kind);
            if (!def) return;
            const measured = flow?.getInternalNode(targetNode.id)?.measured;
            const centre = {
              x: targetNode.position.x + (measured?.width ?? 0) / 2,
              y: targetNode.position.y + (measured?.height ?? 0) / 2,
            };
            const edge = edgeNear(centre);
            if (edge && canSplice(def, targetNode.id, edge)) {
              spliceEdge(props.graph, edge, targetNode.id);
            }
          }}
        >
          <FlowBridge ready={(api) => (flow = api)} />
          <Panel
            position="top-left"
            class="graph-palette"
            style={{ "max-height": "calc(100% - 16px)", "overflow": "hidden" }}
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
                        <Show when={canAdd(def)}>
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
          <Background variant="dots" />
          <Controls position="top-right" />
          <MiniMap />
        </SolidFlow>
      </div>
    </div>
  );
}
