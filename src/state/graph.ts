import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { createStore } from "solid-js/store";
import { nodeKind, toSpec, type GraphKind, type GraphScope, type GraphSpec } from "../lib/graph";
import { isAnchorKind } from "./graphKinds";
import {
  graphFor,
  registerGraph,
  seed,
  type GraphEdge,
  type GraphHandle,
  type GraphNode,
} from "./graphHandles";

/**
 * The filter and synth graphs: their stores live in [`graphHandles`](./graphHandles.ts)
 * — the registry every graph **scope** shares with subsystems — and this module owns
 * the filter graph's push to the Rust core plus the project-level summaries.
 *
 * The filter graph is pushed to the core (debounced) so preview playback applies it;
 * the synth graph is sent to the core only when rendered.
 */

export * from "./graphHandles";

const filterSeed = seed("filter");
const [filterNodes, setFilterNodes] = createStore<GraphNode[]>(filterSeed.nodes);
const [filterEdges, setFilterEdges] = createStore<GraphEdge[]>(filterSeed.edges);
registerGraph("filter", {
  nodes: filterNodes,
  edges: filterEdges,
  setNodes: setFilterNodes,
  setEdges: setFilterEdges,
});

const synthSeed = seed("synth");
const [synthNodes, setSynthNodes] = createStore<GraphNode[]>(synthSeed.nodes);
const [synthEdges, setSynthEdges] = createStore<GraphEdge[]>(synthSeed.edges);
registerGraph("synth", {
  nodes: synthNodes,
  edges: synthEdges,
  setNodes: setSynthNodes,
  setEdges: setSynthEdges,
});

export const FILTER_GRAPH: GraphHandle = graphFor("filter");
export const SYNTH_GRAPH: GraphHandle = graphFor("synth");

/** The kinds of a fresh graph's nodes (see [`seed`]). */
function seedKinds(graph: GraphKind): string[] {
  return graph === "filter" ? ["input", "output"] : ["sine", "output"];
}

/** Whether a node still carries its kind's default parameter values. */
function nodeIsDefault(node: GraphNode): boolean {
  const def = nodeKind(node.data.kind);
  return !def || def.params.every((p) => (node.data.params[p.key] ?? p.default) === p.default);
}

/**
 * Whether a graph still has its seeded shape: the seed node kinds in order, default
 * parameters, and the single link between them. Used to tell an untouched project
 * from one whose graphs are worth saving.
 */
export function graphPristine(graph: GraphKind): boolean {
  const handle = graphFor(graph);
  const kinds = seedKinds(graph);
  return (
    handle.nodes.length === kinds.length &&
    handle.nodes.every((node, i) => node.data.kind === kinds[i] && nodeIsDefault(node)) &&
    handle.edges.length === 1 &&
    handle.edges[0].source === handle.nodes[0].id &&
    handle.edges[0].target === handle.nodes[1].id
  );
}

/**
 * Whether the filter graph does more than pass the input through — i.e. the user has
 * composed a filter. The fresh `Input → Output` seed is *not* a composed filter.
 */
export function filterComposed(): boolean {
  return FILTER_GRAPH.nodes.some((node) => !isAnchorKind(node.data.kind));
}

/** Whether at least one `output` node's input is wired (else the graph is silent). */
export function outputConnected(scope: GraphScope): boolean {
  const handle = graphFor(scope);
  return handle.edges.some((edge) => {
    const target = handle.nodes.find((node) => node.id === edge.target);
    return !!target && target.data.kind === "output" && Number(edge.targetHandle ?? 0) === 0;
  });
}

/**
 * How many output channels the filter graph declares: one per `output` node's `Ch`
 * parameter (each node reads one channel), at least 1. The chosen analysis channel can
 * exceed the source's channel count — that is how a graph splits one signal into several
 * branches and is analysed one branch at a time.
 */
export function filterOutputs(): number {
  let high = 0;
  for (const node of FILTER_GRAPH.nodes) {
    if (node.data.kind !== "output") continue;
    const channel = Math.round(node.data.params.channel ?? 0);
    high = Math.max(high, channel);
  }
  return high + 1;
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
/**
 * The user's intent: filter when a filter graph is composed. The **displayed** state is
 * [`filterActive`], so an identity (seeded) graph still reads as off.
 */
export const [filterEnabled, setFilterEnabled] = createSignal(true);

/** Whether a filter is actually applied: enabled *and* a composed graph exists. */
export function filterActive(): boolean {
  return filterEnabled() && filterComposed();
}
/**
 * Bumped after every `set_filter_graph` round-trip. `audio/preview.ts` watches this
 * to reload the active preview, so a filter edit is heard immediately instead of
 * only on the next preview.
 */
export const [filterRevision, setFilterRevision] = createSignal(0);

const DEBOUNCE_MS = 250;
let pushTimer: number | undefined;

/** The filter graph as a spec (nested subsystems included). */
export function filterSpec(): GraphSpec {
  return toSpec(FILTER_GRAPH.nodes, FILTER_GRAPH.edges);
}

async function pushFilterGraph() {
  setFilterApplying(true);
  // The identity seed is not a filter, so it is pushed as a bypass (null).
  const payload = filterActive() ? filterSpec() : null;
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
      () => [filterEnabled(), JSON.stringify(filterSpec())],
      () => scheduleFilterPush(),
    ),
  );
});
