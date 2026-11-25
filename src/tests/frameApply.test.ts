import { afterEach, expect, it, vi } from "vitest";
import { applyOnFrame } from "../state/frameApply";

/**
 * The receive side of the cross-window sync must cost at most one run per key per frame —
 * and none at all while the window is occluded (WebKit suspends `requestAnimationFrame`,
 * so the frame simply does not come). These checks pin both: a burst collapses to its
 * latest value, and a queued key is not dropped by a flush that did not include it.
 *
 * ```sh
 * npm run test:unit
 * ```
 */

/** Replace `requestAnimationFrame` with a queue this test runs by hand. */
function stubFrames() {
  const pending: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
  return {
    /** Run every frame the code has asked for, as the browser would on its next paint. */
    run() {
      for (const cb of pending.splice(0)) cb(0);
    },
    scheduled: () => pending.length,
  };
}

afterEach(() => vi.unstubAllGlobals());

it("collapses a burst for one key into its latest value, once", () => {
  const frames = stubFrames();
  const runs: string[] = [];

  applyOnFrame("cursor:time", () => runs.push("first"));
  applyOnFrame("cursor:time", () => runs.push("second"));
  applyOnFrame("cursor:time", () => runs.push("latest"));

  // Nothing has run yet — that is what keeps an occluded window's backlog at one entry.
  expect(runs).toEqual([]);
  expect(frames.scheduled()).toBe(1);

  frames.run();
  expect(runs).toEqual(["latest"]);
});

it("runs every key once, in the order they were queued, and re-arms for the next frame", () => {
  const frames = stubFrames();
  const runs: string[] = [];

  applyOnFrame("cursor:time", () => runs.push("cursor"));
  applyOnFrame("view:time", () => runs.push("view"));
  frames.run();
  expect(runs).toEqual(["cursor", "view"]);

  // A later patch must schedule a frame of its own.
  applyOnFrame("cursor:time", () => runs.push("again"));
  expect(runs).toEqual(["cursor", "view"]);
  frames.run();
  expect(runs).toEqual(["cursor", "view", "again"]);
});

it("a run that schedules more work is not lost", () => {
  const frames = stubFrames();
  const runs: string[] = [];

  applyOnFrame("graphs", () => {
    runs.push("apply");
    applyOnFrame("timeline", () => runs.push("follow-up"));
  });
  frames.run();
  expect(runs).toEqual(["apply"]);
  frames.run();
  expect(runs).toEqual(["apply", "follow-up"]);
});

it("lands the latest value even when no frame ever comes", () => {
  // A fully occluded window may not repaint at all: the timer must not strand the sync.
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  try {
    const runs: string[] = [];
    applyOnFrame("cursor:time", () => runs.push("latest"));
    expect(runs).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(runs).toEqual(["latest"]);
  } finally {
    vi.useRealTimers();
  }
});
