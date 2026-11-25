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
import { defaultRows } from "../lib/graph/table";
import { surplusAnchors, withDeletable, withoutDeletable } from "../lib/graph/deletable";
import { nextInputChannel, nextOutputChannel } from "../lib/graph/anchorChannel";
import { DROP_NODE_HEIGHT, DROP_NODE_WIDTH } from "../lib/graphDrop";
import { layoutGraph } from "../lib/graphLayout";
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
  /** A subsystem's user-visible name (e.g. `Feedback 2`); empty for other kinds. */
  name?: string;
  /** A subsystem node's nested graph (the compiled/stored form). */
  subgraph?: GraphSpec | null;
  /** A variadic table's rows, row-major (see `lib/graph/table.ts`). */
  table?: number[];
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

function makeNode(
  kind: string,
  scope: GraphScope,
  x: number,
  y: number,
  /** Sibling nodes to scan for a free channel; omit to read the scope's store. */
  siblings?: readonly GraphNode[],
): GraphNode {
  const def = nodeKind(kind);
  const params = def ? defaultParams(def) : {};
  if (def) {
    const nodes = siblings ?? (hasGraph(scope) ? graphFor(scope).nodes : []);
    // A new Output takes the next output channel, a new (second, third, …) Input the next
    // free source channel; the graph's first Input stays on the downmix.
    const channel = nextOutputChannel(def, nodes) ?? nextInputChannel(def, nodes);
    if (channel != null) params.channel = channel;
  }
  const node: GraphNode = {
    id: `${kind}-${nextId++}`,
    type: "graph",
    position: { x, y },
    data: {
      kind,
      params,
      graph: scope,
      // A subsystem starts valid: its tab opens on a minimal inner graph, and it takes
      // the next free default name (`Feedback 1`, `Feedback 2`, …) so the Sidebar and
      // its tab can tell two of them apart before anyone renames them.
      ...(def?.subsystem
        ? {
            subgraph: emptySystemSpec(kind),
            name: defaultName(scope, def),
          }
        : {}),
      // A kind with a variadic table (wavetable partials, sequence notes) starts on its
      // catalog rows.
      ...(def?.table ? { table: defaultRows(kind) } : {}),
    },
  };
  if (isAnchorKind(kind)) {
    // The last Input and the last Output cannot be deleted (a graph needs both), but a
    // surplus one can, and they stay draggable so the user can place them freely.
    node.deletable = false;
  }
  return node;
}

/** The next default name for a subsystem of `def` within `scope`: label + counter. */
function defaultName(scope: GraphScope, def: NodeKindDef): string {
  const existing = hasGraph(scope)
    ? graphFor(scope).nodes.filter((node) => node.data.kind === def.kind).length
    : 0;
  return `${def.label} ${existing + 1}`;
}

/** Give nameless subsystem nodes (an imported DOT / MCP graph) their default names. */
export function fillSystemNames(nodes: readonly GraphNode[]): GraphNode[] {
  const seen = new Map<string, number>();
  return nodes.map((node) => {
    const def = nodeKind(node.data.kind);
    if (!def?.subsystem || node.data.name) return node;
    const count = (seen.get(node.data.kind) ?? 0) + 1;
    seen.set(node.data.kind, count);
    return { ...node, data: { ...node.data, name: `${def.label} ${count}` } };
  });
}

/** The seed nested graph of a new subsystem, as a stored `GraphSpec`.
 *
 *  A plain subsystem is `input → output` (identity). A `resample` inner graph is a
 *  generator (no input); a `sequence` voice is pitched by the note's frequency arriving
 *  on input 0, so it needs a `(cv)` oscillator to sound. */
function emptySystemSpec(kind: string): GraphSpec {
  const nodes =
    kind === "sequence"
      ? [
          { id: "in", kind: "input", params: [], subgraph: null },
          { id: "osc", kind: "saw_cv", params: [], subgraph: null },
          { id: "out", kind: "output", params: [], subgraph: null },
        ]
      : kind === "resample"
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
    edges: nodes.slice(1).map((to, index) => ({
      from: nodes[index].id,
      fromPort: 0,
      to: to.id,
      toPort: 0,
    })),
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
 * A fresh graph: a filter (or a plain subsystem) is `Input → Output` (identity); a
 * synth — and a `resample` inner graph, which takes no input — is `Sine → Output`; a
 * `sequence` voice is `Input → Saw (cv) → Output`.
 */
export function seed(scope: GraphScope, kind?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // A seed is a **fresh** graph, so it ignores any nodes still in the scope's store (a
  // Clear replaces them) and its single Output starts on channel 0.
  const fresh: GraphNode[] = [];
  if (scope === "synth" || kind === "resample") {
    const osc = makeNode("sine", scope, ANCHOR_LEFT_X, ANCHOR_Y, fresh);
    const output = makeNode("output", scope, ANCHOR_RIGHT_X, ANCHOR_Y, fresh);
    return { nodes: [osc, output], edges: [link(osc.id, output.id)] };
  }
  if (kind === "sequence") {
    const input = makeNode("input", scope, ANCHOR_LEFT_X, ANCHOR_Y, fresh);
    const osc = makeNode("saw_cv", scope, (ANCHOR_LEFT_X + ANCHOR_RIGHT_X) / 2, ANCHOR_Y, fresh);
    const output = makeNode("output", scope, ANCHOR_RIGHT_X, ANCHOR_Y, fresh);
    return {
      nodes: [input, osc, output],
      edges: [link(input.id, osc.id), link(osc.id, output.id)],
    };
  }
  const input = makeNode("input", scope, ANCHOR_LEFT_X, ANCHOR_Y, fresh);
  const output = makeNode("output", scope, ANCHOR_RIGHT_X, ANCHOR_Y, fresh);
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

/** Replace one node's variadic table rows (row-major). */
export function setTableRows(scope: GraphScope, id: string, rows: number[]) {
  graphFor(scope).setNodes((node) => node.id === id, "data", "table", rows);
}

/** Rename a subsystem node (an empty name falls back to the kind's label). */
export function renameNode(scope: GraphScope, id: string, name: string) {
  graphFor(scope).setNodes((node) => node.id === id, "data", "name", name.trim());
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

/** Snapshot a graph's editor state for the project file and the shared UI state. */
export function graphLayout(scope: GraphScope): GraphLayout {
  const handle = graphFor(scope);
  // `deletable` is editor-local (see `lib/graph/deletable.ts`), so two windows can never
  // disagree about it in the shared layout.
  return { nodes: handle.nodes.map(withoutDeletable), edges: handle.edges };
}

/** Restore a graph's editor state from a saved project. */
export function loadGraph(scope: GraphScope, state: Partial<GraphLayout> | undefined) {
  if (!state?.nodes?.length) {
    // No saved editor state (or an empty graph): fall back to the seed.
    resetGraph(scope);
    return;
  }
  const handle = graphFor(scope);
  // Derive `deletable` here too, so a window whose editor is not mounted still protects
  // the graph's anchors (and can remove a surplus one).
  const surplus = surplusAnchors(state.nodes);
  handle.setEdges(state.edges ?? []);
  handle.setNodes(state.nodes.map((node) => withDeletable(node, surplus)));
  bumpNextId([...state.nodes, ...(state.edges ?? [])]);
}

/**
 * Replace a graph from a `GraphSpec` (an imported DOT file or an MCP graph).
 *
 * Positions are not part of the interchange, so the graph is **laid out once** here —
 * an imported graph opens readable instead of on an import grid. The layout uses the
 * nominal node box (`graphDrop`), since nothing has been measured yet; the toolbar's
 * **Layout** re-runs it against the measured sizes after edits.
 */
export function loadSpec(scope: GraphScope, spec: GraphSpec) {
  const { nodes, edges } = fromSpec(spec);
  const positions = layoutGraph(
    nodes.map((node) => ({
      id: node.id,
      width: DROP_NODE_WIDTH,
      height: DROP_NODE_HEIGHT,
    })),
    // dagre rejects a self-edge; the compiler rejects it as a cycle anyway, but the
    // layout must not throw before the user can see why.
    edges
      .filter((edge) => edge.source !== edge.target)
      .map((edge) => ({ source: edge.source, target: edge.target })),
  );
  const handle = graphFor(scope);
  handle.setEdges(edges);
  handle.setNodes(
    fillSystemNames(
      nodes.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
        type: "graph" as const,
        data: { ...node.data, graph: scope },
        ...(isAnchorKind(node.data.kind) ? { deletable: false } : {}),
      })),
    ),
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
