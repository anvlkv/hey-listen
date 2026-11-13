import { expect, it } from "vitest";
import { clamp, interpolate } from "../audio/transport";

/**
 * Unit checks for the transport's local interpolation (`src/audio/transport.ts`): the
 * playhead is drawn between the core's polls by extending the last authoritative
 * position at the playback speed, wrapping inside the looped region (M23).
 */

/** Interpolate with a fixed 1-second advance from `secs`. */
function advance(opts: {
  status: "idle" | "playing" | "paused";
  start: number;
  end: number;
  secs: number;
  speed?: number;
  loop?: boolean;
  elapsedMs?: number;
}): number {
  return interpolate({
    status: opts.status,
    region: { start: opts.start, end: opts.end },
    anchor: { secs: opts.secs, at: 1000 },
    speed: opts.speed ?? 1,
    loop: opts.loop ?? true,
    now: 1000 + (opts.elapsedMs ?? 1000),
  });
}

it("keeps the anchor while idle or paused", () => {
  for (const status of ["idle", "paused"] as const) {
    expect(advance({ status, start: 10, end: 20, secs: 12.5 })).toBe(12.5);
  }
});

it("advances by the elapsed time times the speed", () => {
  expect(advance({ status: "playing", start: 0, end: 10, secs: 2 })).toBeCloseTo(3, 6);
  expect(advance({ status: "playing", start: 0, end: 10, secs: 2, speed: 2 })).toBeCloseTo(4, 6);
  expect(advance({ status: "playing", start: 0, end: 10, secs: 2, speed: 0.5 })).toBeCloseTo(
    2.5,
    6,
  );
});

it("wraps inside the region while looping", () => {
  expect(advance({ status: "playing", start: 10, end: 12, secs: 11.5 })).toBeCloseTo(10.5, 6);
});

it("stops at the region end when not looping", () => {
  expect(advance({ status: "playing", start: 10, end: 12, secs: 11.5, loop: false })).toBe(12);
});

it("treats a collapsed region as stationary", () => {
  expect(advance({ status: "playing", start: 5, end: 5, secs: 5 })).toBe(5);
});

it("clamps into a range", () => {
  expect(clamp(4, 0, 3)).toBe(3);
  expect(clamp(-1, 0, 3)).toBe(0);
  expect(clamp(2, 0, 3)).toBe(2);
});
