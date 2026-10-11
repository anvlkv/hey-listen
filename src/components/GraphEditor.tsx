import "@dschz/solid-flow/styles";
import { createSignal, For, onMount, Show, type JSX } from "solid-js";
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
import { resolvedTheme } from "../state/settings";
import GraphNode from "./GraphNode";
import ScrollArea from "./ScrollArea";

const nodeTypes = { graph: GraphNode } satisfies NodeTypes;

/** Palette drag payload MIME type (an HTML5 drag-and-drop data flavour). */
const NODE_DRAG_MIME = "application/x-heylisten-node";
/** Half a node's nominal size, so a dropped node is centred on the cursor. */
const NODE_HALF_WIDTH = 70;
const NODE_HALF_HEIGHT = 27;
/** How close (in flow units) a drop must land to a connector to splice in. */
const SPLICE_RADIUS = 26;

/** Inline styling for the palette search box, matched to the active theme. */
const SEARCH_STYLE_DARK: JSX.CSSProperties = {
  width: "100%",
  "box-sizing": "border-box",
  height: "24px",
  padding: "0 6px",
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

/** Flow canvas theme matched to the app palette (belt-and-braces with `colorMode`). */
const FLOW_STYLE_DARK = {
  "--xy-background-color": "#1f1f1f",
  "--xy-background-pattern-dots-color": "#3a3a3a",
  "--xy-edge-stroke": "#5898ff",
  "--xy-edge-stroke-width": "1.5",
  "--xy-edge-stroke-selected": "#9cc0ff",
  "--xy-handle-background-color": "#6ea8ff",
  "--xy-handle-border-color": "#1f1f1f",
  "--xy-connectionline-stroke": "#6ea8ff",
  "--xy-connectionline-stroke-width": "1.5",
  "--xy-controls-button-background-color": "#2b2b2b",
  "--xy-controls-button-background-color-hover": "#3e3e3e",
  "--xy-controls-button-color": "#e6e6e6",
  "--xy-controls-button-color-hover": "#ffffff",
  "--xy-controls-button-border-color": "#3c3c3c",
  "--xy-minimap-background-color": "#1a1a1a",
  "--xy-minimap-mask-background-color": "rgba(20, 20, 20, 0.65)",
  "--xy-minimap-mask-stroke-color": "#5898ff",
  "--xy-edge-label-background-color": "#2b2b2b",
  "--xy-edge-label-color": "#e6e6e6",
} as JSX.CSSProperties;

/** Light variant of [`FLOW_STYLE_DARK`]: same variables, light values. */
const FLOW_STYLE_LIGHT = {
  "--xy-background-color": "#ffffff",
  "--xy-background-pattern-dots-color": "#d0d4da",
  "--xy-edge-stroke": "#2f6fd0",
  "--xy-edge-stroke-width": "1.5",
  "--xy-edge-stroke-selected": "#1b4fa0",
  "--xy-handle-background-color": "#2f6fd0",
  "--xy-handle-border-color": "#ffffff",
  "--xy-connectionline-stroke": "#2f6fd0",
  "--xy-connectionline-stroke-width": "1.5",
  "--xy-controls-button-background-color": "#ffffff",
  "--xy-controls-button-background-color-hover": "#eef0f4",
  "--xy-controls-button-color": "#1f2328",
  "--xy-controls-button-color-hover": "#000000",
  "--xy-controls-button-border-color": "#d8dce2",
  "--xy-minimap-background-color": "#f0f1f4",
  "--xy-minimap-mask-background-color": "rgba(160, 168, 178, 0.35)",
  "--xy-minimap-mask-stroke-color": "#2f6fd0",
  "--xy-edge-label-background-color": "#ffffff",
  "--xy-edge-label-color": "#1f2328",
} as JSX.CSSProperties;

/** The flow canvas inline theme for the active [`resolvedTheme`] (reactive). */
const flowStyle = () => (resolvedTheme() === "light" ? FLOW_STYLE_LIGHT : FLOW_STYLE_DARK);
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

  /** Whether the event is over the palette (a drop there is treated as a cancel). */
  const overPalette = (event: DragEvent) => !!(event.target as Element | null)?.closest?.(".graph-palette");

  function handleDragOver(event: DragEvent) {
    if (!dragging() || overPalette(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent) {
    const kind = dragging();
    setDragging(null);
    if (!kind || overPalette(event) || !flow) return;
    event.preventDefault();
    const def = nodeKind(kind);
    if (!def || !canAdd(def)) return;
    clearGraphWarning();
    placeNode(def, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }

  return (
    <div class="graph-editor">
      <div class="graph-toolbar">{props.children}</div>
      <div
        class="graph-canvas"
        data-testid="graph.canvas"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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
              <button
                type="button"
                class="graph-palette-toggle"
                aria-expanded={!collapsed()}
                title={collapsed() ? "Expand node palette" : "Collapse node palette"}
                onClick={() => setCollapsed(!collapsed())}
              >
                {collapsed() ? "▸" : "▾"} Nodes
              </button>
            </div>
            <Show when={!collapsed()}>
            <input
              type="text"
              class="graph-palette-search nodrag nopan"
              placeholder="Search nodes…"
              aria-label="Search nodes"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              style={searchStyle()}
            />
            <ScrollArea class="graph-palette-scroll">
            <For each={groups()}>
              {(group) => (
                <div class="graph-palette-group">
                  <div class="graph-palette-title">{group.category}</div>
                  <div class="graph-palette-buttons">
                    <For each={group.kinds}>
                      {(def) => (
                        <Show when={canAdd(def)}>
                          <button
                            type="button"
                            class="graph-palette-btn"
                            data-testid="graph.palette.btn"
                            draggable={true}
                            title={
                              def.hint
                                ? `${def.label} — ${def.hint}\nClick to add, or drag onto the canvas (drop on a connector to insert).`
                                : `Add ${def.label}`
                            }
                            onClick={() => addNode(props.graph, def)}
                            onDragStart={(event) => {
                              setDragging(def.kind);
                              event.dataTransfer?.setData(NODE_DRAG_MIME, def.kind);
                              event.dataTransfer?.setData("text/plain", def.kind);
                              if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
                            }}
                            onDragEnd={() => setDragging(null)}
                          >
                            + {def.label}
                          </button>
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
