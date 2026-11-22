import { createEffect, createRoot, on } from "solid-js";
import { createStore } from "solid-js/store";
import {
  fromSpec,
  isSubsystemKind,
  nodeKind,
  parseSystemScope,
  systemScope,
  toSpec,
  type GraphScope,
  type GraphSpec,
  type SubsystemScope,
} from "../lib/graph";
import {
  bumpNextId,
  forgetGraph,
  graphFor,
  graphScopes,
  hasGraph,
  registerGraph,
  seed,
  type GraphEdge,
  type GraphHandle,
  type GraphNode,
} from "./graphHandles";

/**
 * Subsystems (M40): a node whose kind wraps an **inner graph** owns a nested editor
 * store, keyed by its scope `system:<parent>/<node>`.
 *
 * The nested graph lives on the owning node (`data.subgraph`, the compiled/stored
 * form); an open subsystem tab keeps it in sync through one effect. Closing the tab
 * keeps the store (like the filter/synth tabs), while deleting the node drops it.
 */

export { parseSystemScope, systemScope, type SubsystemScope } from "../lib/graph/scope";

const PREFIX = "system:";

/** One subsystem row: what the Sidebar lists and a tab title shows. */
export interface SubsystemRef {
  scope: SubsystemScope;
  parent: GraphScope;
  node: string;
  kind: string;
  label: string;
}

/** The teardown for each open subsystem's sync effect. */
const DISPOSERS = new Map<string, () => void>();

/** `{ id, kind, subgraph }` for either an editor node or a stored spec node. */
type NodeLike = {
  id: string;
  kind?: string;
  data?: { kind: string; subgraph?: GraphSpec | null };
  subgraph?: GraphSpec | null;
};

const kindOf = (node: NodeLike) => node.data?.kind ?? node.kind ?? "";
const subgraphOf = (node: NodeLike) => node.data?.subgraph ?? node.subgraph ?? null;

/** Every subsystem in the project, in graph order (nested ones included). */
export function subsystems(): SubsystemRef[] {
  const out: SubsystemRef[] = [];
  for (const graph of ["filter", "synth"] as const) {
    if (hasGraph(graph)) walk(graph, graphFor(graph).nodes as NodeLike[], out);
  }
  return out;
}

function walk(parent: GraphScope, nodes: readonly NodeLike[], out: SubsystemRef[]) {
  for (const node of nodes) {
    const kind = kindOf(node);
    if (!isSubsystemKind(kind)) continue;
    const scope = systemScope(parent, node.id);
    out.push({
      scope,
      parent,
      node: node.id,
      kind,
      label: nodeKind(kind)?.label ?? kind,
    });
    const nested = subgraphOf(node);
    if (nested) walk(scope, nested.nodes as NodeLike[], out);
  }
}

/** The owning node of a subsystem, or `undefined` when the scope is stale. */
function ownerNode(scope: SubsystemScope): GraphNode | undefined {
  const ref = parseSystemScope(scope);
  if (!ref) return undefined;
  if (!hasGraph(ref.parent)) {
    // A nested subsystem opened before its parent: build the parent's store first.
    const parentRef = parseSystemScope(ref.parent);
    if (parentRef) ensureSystem(ref.parent as SubsystemScope);
  }
  return hasGraph(ref.parent)
    ? graphFor(ref.parent).nodes.find((node) => node.id === ref.node)
    : undefined;
}

/**
 * Make sure a subsystem's editor store exists, seeded from the owning node's nested
 * spec (or a fresh `Input → Output`). Idempotent.
 */
export function ensureSystem(scope: SubsystemScope): GraphHandle {
  if (hasGraph(scope)) return graphFor(scope);
  const ref = parseSystemScope(scope);
  if (!ref) throw new Error(`not a subsystem scope: ${scope}`);
  const spec = ownerNode(scope)?.data.subgraph ?? null;
  const stored = spec ? fromSpec(spec) : null;
  const base = stored ?? seed(scope);
  const nodes = base.nodes.map((node) => ({
    ...node,
    type: "graph" as const,
    ...(node.data.kind === "input" || node.data.kind === "output" ? { deletable: false } : {}),
    data: { ...node.data, graph: scope },
  })) as GraphNode[];
  const edges = (stored?.edges ?? []) as GraphEdge[];
  const [storeNodes, setNodes] = createStore<GraphNode[]>(nodes);
  const [storeEdges, setEdges] = createStore<GraphEdge[]>(edges);
  const handle: GraphHandle = { nodes: storeNodes, edges: storeEdges, setNodes, setEdges };
  registerGraph(scope, handle);
  bumpNextId([...nodes, ...edges]);
  mirrorToOwner(scope, handle);
  return handle;
}

/** Keep the owning node's `subgraph` in sync with the nested editor store. */
function mirrorToOwner(scope: SubsystemScope, handle: GraphHandle) {
  const dispose = createRoot((disposeRoot) => {
    createEffect(
      on(
        () => JSON.stringify(toSpec(handle.nodes, handle.edges)),
        () => {
          const ref = parseSystemScope(scope);
          if (!ref || !hasGraph(ref.parent)) return;
          graphFor(ref.parent).setNodes(
            (node) => node.id === ref.node,
            "data",
            "subgraph",
            toSpec(handle.nodes, handle.edges),
          );
        },
        { defer: true },
      ),
    );
    return disposeRoot;
  });
  DISPOSERS.set(scope, dispose);
}

/** Drop one subsystem store (its owning node was deleted, or its tab is gone). */
export function dropSystem(scope: SubsystemScope) {
  DISPOSERS.get(scope)?.();
  DISPOSERS.delete(scope);
  forgetGraph(scope);
  // A deleted node takes its own nested subsystems with it.
  const childPrefix = `${PREFIX}${scope}/`;
  for (const key of graphScopes()) {
    if (key.startsWith(childPrefix)) dropSystem(key as SubsystemScope);
  }
}

/** Drop the stores of `nodes` deleted from `parent`. */
export function dropSystemsUnder(parent: GraphScope, nodes: Iterable<string>) {
  for (const id of nodes) dropSystem(systemScope(parent, id));
}

/** Whether `scope` sits anywhere beneath `parent` (directly or nested). */
function isUnder(scope: string, parent: GraphScope): boolean {
  let current = scope;
  while (true) {
    const ref = parseSystemScope(current);
    if (!ref) return false;
    if (ref.parent === parent) return true;
    if (!ref.parent.startsWith(PREFIX)) return false;
    current = ref.parent;
  }
}

/** Every registered subsystem under `parent`, nested ones included. */
export function systemsUnder(parent: GraphScope): SubsystemScope[] {
  return graphScopes()
    .filter((scope) => scope.startsWith(PREFIX) && isUnder(scope, parent))
    .map((scope) => scope as SubsystemScope);
}
