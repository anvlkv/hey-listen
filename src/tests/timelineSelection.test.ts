import { describe, expect, it } from "vitest";
import { selectWindow } from "../components/timeline/selection";
import { laneAtY } from "../components/timeline/waveformLanes";

/**
 * Unit checks for the Timeline's **window selection** (M23): the span a drag selects (in
 * either direction, clamped, never shorter than the analysis minimum) and the lane hit
 * test the drag uses to pick the analysis channel. Runnable without a browser:
 *
 * ```sh
 * npm run test:unit
 * ```
 */

describe("the Timeline's text-like window selection", () => {
  const DURATION = 10;
  const MIN = 0.01;

  it("spans the anchor to the pointer in either direction", () => {
    expect(selectWindow(2, 5, DURATION, MIN)).toEqual({ start: 2, end: 5 });
    expect(selectWindow(5, 2, DURATION, MIN)).toEqual({ start: 2, end: 5 });
  });

  it("clamps both ends to the source", () => {
    expect(selectWindow(-1, 12, DURATION, MIN)).toEqual({ start: 0, end: DURATION });
    expect(selectWindow(12, -1, DURATION, MIN)).toEqual({ start: 0, end: DURATION });
  });

  it("grows a too-short drag away from the anchor", () => {
    const forward = selectWindow(3, 3.001, DURATION, MIN);
    expect(forward.start).toBe(3);
    expect(forward.end).toBeCloseTo(3.01, 10);
    const backward = selectWindow(3, 2.999, DURATION, MIN);
    expect(backward.start).toBeCloseTo(2.99, 10);
    expect(backward.end).toBe(3);
  });

  it("grows backwards when the forward end is at the source end", () => {
    expect(selectWindow(DURATION, DURATION, DURATION, MIN)).toEqual({
      start: DURATION - MIN,
      end: DURATION,
    });
    expect(selectWindow(0, 0, DURATION, MIN)).toEqual({ start: 0, end: MIN });
  });
});

describe("the channel lane under a pointer", () => {
  it("splits the waveform area equally between the channels", () => {
    expect(laneAtY(10, 0, 100, 2)).toBe(0);
    expect(laneAtY(60, 0, 100, 2)).toBe(1);
    expect(laneAtY(10, 0, 100, 4)).toBe(0);
    expect(laneAtY(30, 0, 100, 4)).toBe(1);
  });

  it("clamps past the last lane and ignores points above the waveform", () => {
    expect(laneAtY(140, 0, 100, 3)).toBe(2);
    expect(laneAtY(-1, 0, 100, 2)).toBeNull();
    expect(laneAtY(10, 0, 0, 2)).toBeNull();
  });
});
