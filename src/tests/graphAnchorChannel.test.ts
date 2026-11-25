import { createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import { expect, it } from "vitest";
import { nodeKind, type GraphScope } from "../lib/graph";
import {
  addNode,
  graphFor,
  graphLayout,
  loadGraph,
  registerGraph,
  resetGraph,
  type GraphEdge,
  type GraphNode,
} from "../state/graphHandles";

/** Register a fresh empty graph scope and run `body` against it. */
function withEmptyScope(name: string, body: (scope: GraphScope) => void) {
  createRoot(() => {
    const scope: GraphScope = `system:test-${name}`;
    const [nodes, setNodes] = createStore<GraphNode[]>([]);
    const [edges, setEdges] = createStore<GraphEdge[]>([]);
    registerGraph(scope, { nodes, edges, setNodes, setEdges });
    body(scope);
  });
}

/** A catalog kind these tests need; the catalog must carry it for them to mean anything. */
function kind(name: string) {
  const def = nodeKind(name);
  if (!def) throw new Error(`${name} kind is missing from the catalog`);
  return def;
}

/** The `Ch` params of a scope's nodes of `name`, in node order. */
function channels(scope: GraphScope, name: string): number[] {
  return graphFor(scope)
    .nodes.filter((node) => node.data.kind === name)
    .map((node) => node.data.params.channel);
}

/**
 * A new `output` node must take the next free `Ch`: the core rejects two Outputs on
 * one channel (`DuplicateOutput`), and the Timeline draws one lane per output channel.
 * So adding Outputs in a row should build parallel channels without any manual edit.
 */
it("a new Output takes the next free channel", () => {
  withEmptyScope("outputs", (scope) => {
    addNode(scope, kind("output"));
    addNode(scope, kind("output"));
    addNode(scope, kind("output"));

    expect(channels(scope, "output")).toEqual([0, 1, 2]);

    // Clearing the graph seeds a fresh one, so its single Output starts on channel 0
    // again instead of inheriting the old graph's highest channel.
    resetGraph(scope);
    expect(channels(scope, "output")).toEqual([0]);
  });
});

/**
 * The first `input` node keeps the catalog default (`-1`, the downmix) so a plain filter
 * graph still reads the whole source; each further Input takes a real source channel, so
 * two branches read two channels instead of both reading the mix.
 */
it("the first Input downmixes and each further Input takes a source channel", () => {
  withEmptyScope("inputs", (scope) => {
    addNode(scope, kind("input"));
    expect(channels(scope, "input")).toEqual([-1]);

    addNode(scope, kind("input"));
    addNode(scope, kind("input"));
    expect(channels(scope, "input")).toEqual([-1, 0, 1]);

    // A seeded graph is a single downmixing Input again.
    resetGraph(scope);
    expect(channels(scope, "input")).toEqual([-1]);
  });
});

/** The `deletable` flags of a scope's nodes of `name`, in node order. */
function deletable(scope: GraphScope, name: string): (boolean | undefined)[] {
  return graphFor(scope)
    .nodes.filter((node) => node.data.kind === name)
    .map((node) => node.deletable);
}

/**
 * `deletable` is derived by the editor from the anchor counts, so it must stay out of the
 * layout that two windows share: otherwise the window with the editor mounted writes
 * `true` for a surplus anchor while the other keeps `false`, and the layouts ping-pong.
 */
it("the shared graph layout omits the editor-local deletable flag", () => {
  withEmptyScope("deletable", (scope) => {
    addNode(scope, kind("output"));
    addNode(scope, kind("output"));
    addNode(scope, kind("input"));
    addNode(scope, kind("input"));

    const layout = graphLayout(scope);
    expect(layout.nodes.every((node) => !("deletable" in node))).toBe(true);

    // Restoring re-derives the flags: a surplus anchor is removable.
    loadGraph(scope, layout);
    expect(deletable(scope, "output")).toEqual([true, true]);
    expect(deletable(scope, "input")).toEqual([true, true]);

    // The last anchor of each kind is locked, so a graph can never lose its entry or exit.
    loadGraph(scope, { nodes: [layout.nodes[0], layout.nodes[2]], edges: [] });
    expect(deletable(scope, "output")).toEqual([false]);
    expect(deletable(scope, "input")).toEqual([false]);
  });
});
