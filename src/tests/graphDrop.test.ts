import { expect, it } from "vitest";
import { nodeKind } from "../lib/graph";
import {
  DROP_NODE_HEIGHT,
  DROP_NODE_WIDTH,
  dropTarget,
  kindAvailable,
  type DropFlow,
} from "../lib/graphDrop";

/**
 * Unit checks for the palette drop target (M22): the preview and the real drop share
 * `dropTarget`, so these cover plain placement, splicing into a connector, and an
 * unavailable node kind (which reads as not-allowed).
 */

const nodes = [{ data: { kind: "input" } }, { data: { kind: "output" } }];

function handleWithEdge() {
  return {
    nodes,
    edges: [{ id: "edge-1", source: "a", target: "b", sourceHandle: "0", targetHandle: "0" }],
  };
}

/** A flow whose `a→b` handle centres sit at (100, 0) and (200, 0). */
const flow: DropFlow = {
  getInternalNode: (id: string) => ({
    internals: {
      positionAbsolute: { x: 0, y: 0 },
      handleBounds: {
        source: [{ id: "0", x: id === "a" ? 100 : 0, y: 0, width: 1, height: 1 }],
        target: [{ id: "0", x: id === "b" ? 200 : 0, y: 0, width: 1, height: 1 }],
      },
    },
  }),
};

it("centres the node on the pointer when it is not over a connector", () => {
  const def = nodeKind("gain");
  expect(def).toBeTruthy();
  const target = dropTarget("filter", { nodes, edges: [] }, undefined, def!, { x: 200, y: 100 });
  expect(target).not.toBeNull();
  expect(target!.position).toEqual({
    x: 200 - DROP_NODE_WIDTH / 2,
    y: 100 - DROP_NODE_HEIGHT / 2,
  });
  expect(target!.edge).toBeNull();
});

it("splices a node with both ports into the connector under the pointer", () => {
  const def = nodeKind("gain");
  const target = dropTarget("filter", handleWithEdge(), flow, def!, { x: 150, y: 0 });
  expect(target!.edge?.id).toBe("edge-1");
});

it("does not promise a splice for a generator (no input)", () => {
  const def = nodeKind("sine");
  expect(def?.inputPorts.length).toBe(0);
  const target = dropTarget("synth", handleWithEdge(), flow, def!, { x: 150, y: 0 });
  expect(target!.edge).toBeNull();
});

it("rejects a second input, and an input in a synth graph", () => {
  expect(kindAvailable("filter", nodes, "input")).toBe(false);
  expect(kindAvailable("synth", nodes, "input")).toBe(false);
  // One `output` per channel: a filter graph is analysed per channel and a synth render
  // becomes a multi-channel source, so outputs are always addable in both graphs.
  expect(kindAvailable("filter", nodes, "output")).toBe(true);
  expect(kindAvailable("synth", [{ data: { kind: "sine" } }], "output")).toBe(true);

  expect(
    dropTarget("filter", { nodes, edges: [] }, undefined, nodeKind("input")!, { x: 0, y: 0 }),
  ).toBeNull();
  expect(
    dropTarget("synth", { nodes: [], edges: [] }, undefined, nodeKind("input")!, { x: 0, y: 0 }),
  ).toBeNull();
});
