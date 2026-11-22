import type { SetStoreFunction } from "solid-js/store";
import type { Edge, Node } from "@dschz/solid-flow";
import {
  defaultParams,
  fromSpec,
  nodeKind,
  type GraphScope,
  type GraphSpec,
  type NodeKindDef,
} from "../lib/graph";
import { isAnchorKind } from "./graphKinds";

/**
 * The graph handle registry: the editor stores for every **scope** — the filter and
 * synth graphs, and each subsystem's nested graph. Kept apart from `state/graph.ts`
 * so the subsystem machinery can register a handle without a module cycle.
 *
 * The stores are module-scope, so a graph survives its Workbench tab being closed and
 * reopened (dockview unmounts hidden panel content).
 */

export type GraphNodeData = {
  kind: string;
  params: Record<string, number>;
  /** The scope that holds this node (`filter`, `synth`, or `system:…`). */
  graph: GraphScope;
  /** A subsystem node's nested graph (the compiled/stored form). */
  subgraph?: GraphSpec | null;
} & Record<string, unknown>;

export type GraphNode = Node<GraphNodeData, "graph">;
export type GraphEdge = Edge;

export interface GraphHandle {
  nodes: GraphNode[];
  edges: GraphEdge[];
  setNodes: SetStoreFunction<GraphNode[]>;
  setEdges: SetStoreFunction<GraphEdge[]>;
}

const HANDLES = new Map<string, GraphHandle>();

/** The editor handle for a scope. A scope must be registered before use. */
export function graphFor(scope: GraphScope): GraphHandle {
  const handle = HANDLES.get(scope);
  if (!handle) throw new Error(`no graph for scope ${scope}`);
  return handle;
}

export function hasGraph(scope: GraphScope): boolean {
  return HANDLES.has(scope);
}

/** Every registered scope (the two editors and any subsystem stores). */
export function graphScopes(): string[] {
  return [...HANDLES.keys()];
}

/** Register (or replace) a scope's handle. */
export function registerGraph(scope: GraphScope, handle: GraphHandle) {
  HANDLES.set(scope, handle);
}

/** Forget a scope's handle (a deleted subsystem). */
export function forgetGraph(scope: GraphScope) {
  HANDLES.delete(scope);
}

let nextId = 1;

/** Default x positions for freshly-seeded Input / Output anchors. */
export const ANCHOR_LEFT_X = 40;
export const ANCHOR_RIGHT_X = 760;
const ANCHOR_Y = 150;

function makeNode(kind: string, scope: GraphScope, x: number, y: number): GraphNode {
  const def = nodeKind(kind);
  const node: GraphNode = {
    id: `${kind}-${nextId++}`,
    type: "graph",
    position: { x, y },
    data: {
      kind,
      params: def ? defaultParams(def) : {},
      graph: scope,
      // A subsystem starts valid: its tab opens on a minimal inner graph.
      ...(def?.subsystem ? { subgraph: emptySystemSpec(kind === "resample") } : {}),
    },
  };
  if (isAnchorKind(kind)) {
    // Anchors cannot be deleted (there must always be one input/output), but they
    // stay draggable so the user can place them freely.
    node.deletable = false;
  }
  return node;
}

/** The seed nested graph of a new subsystem: `Input → Output`, or a sine generator
 *  for `resample` (whose inner graph takes no input). */
function emptySystemSpec(generator: boolean): GraphSpec {
  const nodes = generator
    ? [
        { id: "osc", kind: "sine", params: [440], subgraph: null },
        { id: "out", kind: "output", params: [], subgraph: null },
      ]
    : [
        { id: "in", kind: "input", params: [], subgraph: null },
        { id: "out", kind: "output", params: [], subgraph: null },
      ];
  return {
    nodes,
    edges: [{ from: nodes[0].id, fromPort: 0, to: "out", toPort: 0 }],
  };
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
 * A fresh graph: a filter (or a subsystem) is `Input → Output` (identity); a synth is
 * `Sine → Output`.
 */
export function seed(scope: GraphScope): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (scope === "synth") {
    const osc = makeNode("sine", scope, ANCHOR_LEFT_X, ANCHOR_Y);
    const output = makeNode("output", scope, ANCHOR_RIGHT_X, ANCHOR_Y);
    return { nodes: [osc, output], edges: [link(osc.id, output.id)] };
  }
  const input = makeNode("input", scope, ANCHOR_LEFT_X, ANCHOR_Y);
  const output = makeNode("output", scope, ANCHOR_RIGHT_X, ANCHOR_Y);
  return { nodes: [input, output], edges: [link(input.id, output.id)] };
}

/** Append a new node of `def`, staggered so nodes do not stack. */
export function addNode(scope: GraphScope, def: NodeKindDef) {
  const handle = graphFor(scope);
  const count = handle.nodes.length;
  const node = makeNode(def.kind, scope, 60 + (count % 4) * 200, 60 + Math.floor(count / 4) * 160);
  handle.setNodes((nodes) => [...nodes, node]);
}

/**
 * Append a new node of `def` at a specific flow position (top-left), used when a
 * palette node is dropped onto the canvas. Returns the created node.
 */
export function addNodeAt(
  scope: GraphScope,
  def: NodeKindDef,
  position: { x: number; y: number },
): GraphNode {
  const node = makeNode(def.kind, scope, position.x, position.y);
  graphFor(scope).setNodes((nodes) => [...nodes, node]);
  return node;
}

/**
 * Split `edge` around `nodeId`: remove `source → target` and wire
 * `source → node` (input 0) + `node → target` (output 0), keeping the original
 * ports. The caller is responsible for confirming the node fits (has an input and
 * an output, both free) and that no cycle results.
 */
export function spliceEdge(scope: GraphScope, edge: GraphEdge, nodeId: string): void {
  graphFor(scope).setEdges((edges) => [
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
export function updateParam(scope: GraphScope, id: string, key: string, value: number) {
  graphFor(scope).setNodes((node) => node.id === id, "data", "params", key, value);
}

/** Reset every parameter of one node to its kind's default (the node context menu). */
export function resetNode(scope: GraphScope, id: string) {
  const node = graphFor(scope).nodes.find((current) => current.id === id);
  const def = node ? nodeKind(node.data.kind) : undefined;
  if (!node || !def) return;
  for (const param of def.params) updateParam(scope, id, param.key, param.default);
}

/** Persist a node's position (mirrored from the flow on drag stop). */
export function setNodesPosition(
  scope: GraphScope,
  id: string,
  position: { x: number; y: number },
) {
  graphFor(scope).setNodes((node) => node.id === id, "position", position);
}

/** Apply a batch of computed positions (the autolayout action). */
export function setNodesPositions(
  scope: GraphScope,
  positions: Record<string, { x: number; y: number }>,
) {
  const handle = graphFor(scope);
  for (const [id, position] of Object.entries(positions)) {
    handle.setNodes((node) => node.id === id, "position", position);
  }
}

/** Replace a graph with its seed (the toolbar's Clear action). */
export function resetGraph(scope: GraphScope) {
  const handle = graphFor(scope);
  const { nodes, edges } = seed(scope);
  handle.setEdges(edges);
  handle.setNodes(nodes);
}

/** A graph's persisted editor state (nodes + edges, including positions). */
export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Snapshot a graph's editor state for the project file. */
export function graphLayout(scope: GraphScope): GraphLayout {
  const handle = graphFor(scope);
  return { nodes: handle.nodes, edges: handle.edges };
}

/** Restore a graph's editor state from a saved project. */
export function loadGraph(scope: GraphScope, state: Partial<GraphLayout> | undefined) {
  if (!state?.nodes?.length) {
    // No saved editor state (or an empty graph): fall back to the seed.
    resetGraph(scope);
    return;
  }
  const handle = graphFor(scope);
  handle.setEdges(state.edges ?? []);
  handle.setNodes(
    state.nodes.map((node) =>
      isAnchorKind(node.data.kind) ? { ...node, deletable: false } : node,
    ),
  );
  bumpNextId([...state.nodes, ...(state.edges ?? [])]);
}

/**
 * Replace a graph from a `GraphSpec` (an imported DOT file or an MCP graph).
 * Positions are not part of the interchange; the nodes land on a grid.
 */
export function loadSpec(scope: GraphScope, spec: GraphSpec) {
  const { nodes, edges } = fromSpec(spec);
  const handle = graphFor(scope);
  handle.setEdges(edges);
  handle.setNodes(
    nodes.map((node) => ({
      ...node,
      type: "graph" as const,
      data: { ...node.data, graph: scope },
      ...(isAnchorKind(node.data.kind) ? { deletable: false } : {}),
    })),
  );
  bumpNextId([...nodes, ...edges]);
}

/** Keep generated ids from colliding with restored ones (`kind-3`, `edge-7`, …). */
export function bumpNextId(items: { id: string }[]) {
  for (const item of items) {
    const match = /-(\d+)$/.exec(item.id);
    if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
  }
}
