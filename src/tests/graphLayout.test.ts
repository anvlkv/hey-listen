import { expect, it } from "vitest";
import { layoutGraph } from "../lib/graphLayout";

const box = (id: string) => ({ id, width: 140, height: 54 });

it("lays a chain out left to right", () => {
  const positions = layoutGraph(
    [box("a"), box("b"), box("c")],
    [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ],
  );
  expect(positions.a.x).toBeLessThan(positions.b.x);
  expect(positions.b.x).toBeLessThan(positions.c.x);
  expect(positions.a.y).toBeCloseTo(positions.c.y);
});

it("puts siblings in one rank and keeps their boxes apart", () => {
  const positions = layoutGraph(
    [box("a"), box("b"), box("c")],
    [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
    ],
  );
  expect(positions.b.x).toBeCloseTo(positions.c.x);
  expect(Math.abs(positions.b.y - positions.c.y)).toBeGreaterThanOrEqual(54);
});

it("returns top-left positions, not dagre's centres", () => {
  const positions = layoutGraph([box("a")], []);
  // A centre would be at least half the node's width; the top-left is left of that.
  expect(positions.a.x).toBeLessThan(70);
  expect(positions.a.y).toBeLessThan(27);
});
