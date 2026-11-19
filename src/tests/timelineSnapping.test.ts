import { describe, expect, it } from "vitest";
import { snapMove, snapSpan, snapTime, type SnapOptions } from "../components/timeline/snapping";

/**
 * Unit checks for the Timeline's **snapping** (D-12): a candidate within the tolerance wins,
 * otherwise the zoom-dependent grid step does; the result is clamped to the source; a span
 * snaps both ends and orders them; a moved window keeps its width. Runnable without a
 * browser:
 *
 * ```sh
 * npm run test:unit
 * ```
 */

/** Targets at 1 s and 4 s, 0.2 s of tolerance, a 0.5 s grid over a 10 s source. */
function options(over: Partial<SnapOptions> = {}): SnapOptions {
  return { candidates: [1, 4], tolerance: 0.2, grid: 0.5, duration: 10, ...over };
}

describe("snapping one time", () => {
  it("takes the nearest candidate within the tolerance", () => {
    expect(snapTime(1.15, options())).toBe(1);
    expect(snapTime(3.9, options())).toBe(4);
  });

  it("prefers a candidate even when a grid line is nearer", () => {
    // 1.0 is one tolerance away; the 1.2 grid line is closer but a marker still wins.
    expect(snapTime(1.15, options({ grid: 0.1 }))).toBe(1);
  });

  it("falls back to the nearest grid line", () => {
    expect(snapTime(2.3, options())).toBe(2.5);
    expect(snapTime(2.7, options())).toBe(2.5);
  });

  it("treats the tolerance as inclusive", () => {
    expect(snapTime(1.2, options())).toBe(1);
    expect(snapTime(1.21, options({ grid: 0.001 }))).toBeCloseTo(1.21, 10);
  });

  it("clamps to the source", () => {
    expect(snapTime(-3, options())).toBe(0);
    expect(snapTime(99, options())).toBe(10);
  });

  it("leaves the time alone for a non-finite or non-positive grid", () => {
    expect(snapTime(2.3, options({ grid: 0 }))).toBe(2.3);
    expect(snapTime(2.3, options({ grid: Number.POSITIVE_INFINITY }))).toBe(2.3);
  });

  it("is idempotent, so a gesture cannot drift along the grid", () => {
    const snapped = snapTime(2.3, options());
    expect(snapTime(snapped, options())).toBe(snapped);
  });
});

describe("snapping a span", () => {
  it("snaps both ends and orders them", () => {
    expect(snapSpan(1.1, 3.9, options())).toEqual({ start: 1, end: 4 });
    expect(snapSpan(3.9, 1.1, options())).toEqual({ start: 1, end: 4 });
  });

  it("clamps a span reaching past the source", () => {
    expect(snapSpan(-2, 12, options())).toEqual({ start: 0, end: 10 });
  });
});

describe("snapping a moved window", () => {
  it("keeps the width when the start snaps", () => {
    // Start 2.9 is 0.1 from the 3.0 line; the end 3.2 is 0.2 from it, so the start wins.
    expect(snapMove(2.9, 0.3, options())).toBe(3);
  });

  it("keeps the width when the end snaps", () => {
    // End 3.9 is a candidate 0.1 away; the start is 0.2 from the 2.5 line, so the end wins.
    expect(snapMove(2.3, 1.6, options())).toBeCloseTo(2.4, 10);
  });

  it("keeps the window inside the source", () => {
    expect(snapMove(9.9, 1, options())).toBe(9);
    expect(snapMove(0.04, 2, options())).toBe(0);
  });
});
