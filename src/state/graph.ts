import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { createStore, type SetStoreFunction } from "solid-js/store";
import type { Edge, Node } from "@dschz/solid-flow";
import {
  defaultParams,
  handlePort,
  nodeKind,
  toSpec,
  type GraphKind,
  type NodeKindDef,
} from "../lib/graph";

/**
 * Graph store (module scope, so a graph survives its Workbench tab being closed
 * and reopened — dockview unmounts hidden panel content).
 *
 * The filter graph is pushed to the Rust core (debounced) so preview playback
 * applies it; the synth graph is sent to the core only when rendered.
 */

export type GraphNodeData = {
  kind: string;
  params: Record<string, number>;
  graph: GraphKind;
} & Record<string, unknown>;

export type GraphNode = Node<GraphNodeData, "graph">;
export type GraphEdge = Edge;

export interface GraphHandle {
  nodes: GraphNode[];
  edges: GraphEdge[];
  setNodes: SetStoreFunction<GraphNode[]>;
  setEdges: SetStoreFunction<GraphEdge[]>;
}

let nextId = 1;

/** Default x positions for freshly-seeded Input / Output anchors. */
export const ANCHOR_LEFT_X = 40;
export const ANCHOR_RIGHT_X = 760;
const ANCHOR_Y = 150;

/** Whether a kind is a graph anchor (Input / Output): undeletable and pinned. */
export function isAnchorKind(kind: string): boolean {
  return kind === "input" || kind === "output";
}

function makeNode(kind: string, graph: GraphKind, x: number, y: number): GraphNode {
  const def = nodeKind(kind);
  const node: GraphNode = {
    id: `${kind}-${nextId++}`,
    type: "graph",
    position: { x, y },
    data: { kind, params: def ? defaultParams(def) : {}, graph },
  };
  if (isAnchorKind(kind)) {
    // Anchors cannot be deleted (there must always be one input/output), but they
    // stay draggable so the user can place them freely.
    node.deletable = false;
  }
  return node;
}

function link(source: string, target: string, targetPort = 0): GraphEdge {
  return {
    id: `edge-${nextId++}`,
    source,
    target,
    sourceHandle: "0",
    targetHandle: String(targetPort),
  };
}

/**
 * A fresh graph: a filter is `Input → Output` (identity); a synth is
 * `Sine → Output`.
 */
function seed(graph: GraphKind): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (graph === "filter") {
    const input = makeNode("input", graph, ANCHOR_LEFT_X, ANCHOR_Y);
    const output = makeNode("output", graph, ANCHOR_RIGHT_X, ANCHOR_Y);
    return { nodes: [input, output], edges: [link(input.id, output.id)] };
  }
  const osc = makeNode("sine", graph, ANCHOR_LEFT_X, ANCHOR_Y);
  const output = makeNode("output", graph, ANCHOR_RIGHT_X, ANCHOR_Y);
  return { nodes: [osc, output], edges: [link(osc.id, output.id)] };
}

/** Ensure an anchor stays undeletable (its position is the user's to drag). */
function guardAnchor(node: GraphNode): GraphNode {
  if (!isAnchorKind(node.data.kind)) return node;
  return { ...node, deletable: false };
}

const filterSeed = seed("filter");
const [filterNodes, setFilterNodes] = createStore<GraphNode[]>(filterSeed.nodes);
const [filterEdges, setFilterEdges] = createStore<GraphEdge[]>(filterSeed.edges);
const synthSeed = seed("synth");
const [synthNodes, setSynthNodes] = createStore<GraphNode[]>(synthSeed.nodes);
const [synthEdges, setSynthEdges] = createStore<GraphEdge[]>(synthSeed.edges);

export const FILTER_GRAPH: GraphHandle = {
  nodes: filterNodes,
  edges: filterEdges,
  setNodes: setFilterNodes,
  setEdges: setFilterEdges,
};

export const SYNTH_GRAPH: GraphHandle = {
  nodes: synthNodes,
  edges: synthEdges,
  setNodes: setSynthNodes,
  setEdges: setSynthEdges,
};

export function graphFor(graph: GraphKind): GraphHandle {
  return graph === "filter" ? FILTER_GRAPH : SYNTH_GRAPH;
}

/** Append a new node of `def`, staggered so nodes do not stack. */
export function addNode(graph: GraphKind, def: NodeKindDef) {
  const handle = graphFor(graph);
  const count = handle.nodes.length;
  const node = makeNode(def.kind, graph, 60 + (count % 4) * 200, 60 + Math.floor(count / 4) * 160);
  handle.setNodes((nodes) => [...nodes, node]);
}

/**
 * Append a new node of `def` at a specific flow position (top-left), used when a
 * palette node is dropped onto the canvas. Returns the created node.
 */
export function addNodeAt(
  graph: GraphKind,
  def: NodeKindDef,
  position: { x: number; y: number },
): GraphNode {
  const node = makeNode(def.kind, graph, position.x, position.y);
  graphFor(graph).setNodes((nodes) => [...nodes, node]);
  return node;
}

/**
 * Split `edge` around `nodeId`: remove `source → target` and wire
 * `source → node` (input 0) + `node → target` (output 0), keeping the original
 * ports. The caller is responsible for confirming the node fits (has an input and
 * an output, both free) and that no cycle results.
 */
export function spliceEdge(graph: GraphKind, edge: GraphEdge, nodeId: string): void {
  graphFor(graph).setEdges((edges) => [
    ...edges.filter((current) => current.id !== edge.id),
    {
      id: `edge-${nextId++}`,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? "0",
      target: nodeId,
      targetHandle: "0",
    },
    {
      id: `edge-${nextId++}`,
      source: nodeId,
      sourceHandle: "0",
      target: edge.target,
      targetHandle: edge.targetHandle ?? "0",
    },
  ]);
}

/** Update one parameter of a node in place. */
export function updateParam(graph: GraphKind, id: string, key: string, value: number) {
  graphFor(graph).setNodes((node) => node.id === id, "data", "params", key, value);
}

/** Persist a node's position (mirrored from the flow on drag stop). */
export function setNodesPosition(graph: GraphKind, id: string, position: { x: number; y: number }) {
  graphFor(graph).setNodes((node) => node.id === id, "position", position);
}

/** Replace a graph with its seed (the toolbar's Clear action). */
export function resetGraph(graph: GraphKind) {
  const handle = graphFor(graph);
  const { nodes, edges } = seed(graph);
  handle.setEdges(edges);
  handle.setNodes(nodes);
}

/** A graph's persisted editor state (nodes + edges, including positions). */
export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Snapshot a graph's editor state for the project file. */
export function graphLayout(graph: GraphKind): GraphLayout {
  const handle = graphFor(graph);
  return { nodes: handle.nodes, edges: handle.edges };
}

/** Restore a graph's editor state from a saved project. */
export function loadGraph(graph: GraphKind, state: Partial<GraphLayout> | undefined) {
  if (!state?.nodes?.length) {
    // No saved editor state (or an empty graph): fall back to the seed.
    resetGraph(graph);
    return;
  }
  const handle = graphFor(graph);
  handle.setEdges(state.edges ?? []);
  handle.setNodes(state.nodes.map(guardAnchor));
  bumpNextId([...state.nodes, ...(state.edges ?? [])]);
}

/** Keep generated ids from colliding with restored ones (`kind-3`, `edge-7`, …). */
function bumpNextId(items: { id: string }[]) {
  for (const item of items) {
    const match = /-(\d+)$/.exec(item.id);
    if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
  }
}

/** Whether the graph already contains a node of `kind` (anchors are unique). */
export function hasKind(graph: GraphKind, kind: string): boolean {
  return graphFor(graph).nodes.some((node) => node.data.kind === kind);
}

/** Whether the single `output` node's input is wired (else the graph is silent). */
export function outputConnected(graph: GraphKind): boolean {
  const handle = graphFor(graph);
  return handle.edges.some((edge) => {
    const target = handle.nodes.find((node) => node.id === edge.target);
    return !!target && target.data.kind === "output" && handlePort(edge.targetHandle) === 0;
  });
}

// --- validation warnings -------------------------------------------------

/** A transient message shown when a connection is rejected (see `GraphEditor`). */
export const [graphWarning, setGraphWarning] = createSignal<string | null>(null);
let warningTimer: number | undefined;

export function warnGraph(message: string) {
  setGraphWarning(message);
  if (warningTimer != null) clearTimeout(warningTimer);
  warningTimer = window.setTimeout(() => setGraphWarning(null), 2600);
}

export function clearGraphWarning() {
  if (warningTimer != null) clearTimeout(warningTimer);
  warningTimer = undefined;
  setGraphWarning(null);
}

// --- filter graph → core -------------------------------------------------

export const [filterError, setFilterError] = createSignal<string | null>(null);
export const [filterApplying, setFilterApplying] = createSignal(false);
/** Whether the filter graph is applied to preview (and, later, analysis). */
export const [filterEnabled, setFilterEnabled] = createSignal(true);
/**
 * Bumped after every `set_filter_graph` round-trip. `audio/preview.ts` watches this
 * to reload the active preview, so a filter edit is heard immediately instead of
 * only on the next preview.
 */
export const [filterRevision, setFilterRevision] = createSignal(0);

const DEBOUNCE_MS = 250;
let pushTimer: number | undefined;

async function pushFilterGraph() {
  setFilterApplying(true);
  const spec = toSpec(FILTER_GRAPH.nodes, FILTER_GRAPH.edges);
  const payload = filterEnabled() && spec.nodes.length > 0 ? spec : null;
  try {
    await invoke("set_filter_graph", { spec: payload });
    setFilterError(null);
  } catch (err) {
    setFilterError(String(err));
  } finally {
    setFilterApplying(false);
    // Refresh the preview whether the filter changed (success) or was cleared on
    // error — either way the core's active filter is now different.
    setFilterRevision((revision) => revision + 1);
  }
}

function scheduleFilterPush() {
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => void pushFilterGraph(), DEBOUNCE_MS);
}

/** Apply the filter graph to the core right now, skipping the debounce (MCP). */
export async function flushFilterGraph(): Promise<void> {
  if (pushTimer != null) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
  await pushFilterGraph();
}

// Push whenever the graph (or the enable toggle) changes, and once on startup.
createRoot(() => {
  createEffect(
    on(
      () => [filterEnabled(), JSON.stringify(toSpec(FILTER_GRAPH.nodes, FILTER_GRAPH.edges))],
      () => scheduleFilterPush(),
    ),
  );
});
