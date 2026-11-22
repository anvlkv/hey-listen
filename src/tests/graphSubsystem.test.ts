import { describe, expect, it } from "vitest";
import {
  fromSpec,
  graphThumbnail,
  parseSystemScope,
  systemScope,
  toSpec,
  type GraphSpec,
} from "../lib/graph";

/** A nested chain: in → lowpass(800, 1.2) → out. */
function nestedSpec(): GraphSpec {
  return {
    nodes: [
      { id: "in", kind: "input", params: [], subgraph: null },
      { id: "lp", kind: "lowpass", params: [800, 1.2], subgraph: null },
      { id: "out", kind: "output", params: [], subgraph: null },
    ],
    edges: [
      { from: "in", fromPort: 0, to: "lp", toPort: 0 },
      { from: "lp", fromPort: 0, to: "out", toPort: 0 },
    ],
  };
}

describe("graph subsystems", () => {
  it("keeps a nested graph through toSpec/fromSpec", () => {
    const nodes = [
      { id: "in", data: { kind: "input", params: {} } },
      {
        id: "fb",
        data: {
          kind: "feedback",
          params: {},
          subgraph: nestedSpec(),
        },
      },
      { id: "out", data: { kind: "output", params: {} } },
    ];
    const edges = [
      { source: "in", target: "fb", sourceHandle: "0", targetHandle: "0" },
      { source: "fb", target: "out", sourceHandle: "0", targetHandle: "0" },
    ];

    const spec = toSpec(nodes, edges);
    expect(spec.nodes[1].subgraph?.nodes).toHaveLength(3);
    expect(spec.nodes[0].subgraph ?? null).toBeNull();

    const restored = fromSpec(spec);
    const nested = restored.nodes[1].data.subgraph;
    expect(nested?.nodes[1].kind).toBe("lowpass");
    expect(nested?.nodes[1].params).toEqual([800, 1.2]);
    expect(nested?.edges).toHaveLength(2);
  });

  it("addresses nested subsystems by their parent path", () => {
    expect(systemScope("filter", "fb-3")).toBe("system:filter/fb-3");
    expect(parseSystemScope("system:filter/fb-3")).toEqual({ parent: "filter", node: "fb-3" });
    expect(parseSystemScope("system:system:filter/fb-3/gain-2")).toEqual({
      parent: "system:filter/fb-3",
      node: "gain-2",
    });
    expect(parseSystemScope("filter")).toBeNull();
    expect(parseSystemScope("system:filter/")).toBeNull();
  });

  it("lays the preview out in depth columns", () => {
    const thumb = graphThumbnail(nestedSpec());
    expect(thumb.nodes).toHaveLength(3);
    expect(thumb.links).toHaveLength(2);
    const xs = thumb.nodes.map((node) => node.x);
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(graphThumbnail(null).nodes).toHaveLength(0);
  });
});
