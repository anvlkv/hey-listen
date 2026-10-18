import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { SPEED_MAX, SPEED_MIN } from "../lib/previewSpeed";
import { channel, channelArg } from "../state/analysis";
import { filterRevision } from "../state/graph";
import { outputDeviceId } from "../state/output";
import { windowEnd, windowStart } from "../state/timeline";

/**
 * Preview playback, driven by the Rust core (ADR-9).
 *
 * The core owns the source PCM, the filter graph and the output stream; this
 * module issues fire-and-forget commands and tracks the looped region locally so
 * the Timeline can draw the playhead without polling the core every frame.
 *
 * The core filters the region *when it is loaded*, so when the filter graph (or the
 * analysis channel / output device) changes while a preview is playing, the region
 * is re-issued — otherwise a filter edit would only be heard on the next preview.
 * A preview started on the analysis window (`previewWindow`) also reloads once the
 * window settles, so moving it never keeps auditioning the old region.
 *
 * **Speed** is *varispeed* (M14 follow-up): the core resamples the region, so a rate
 * shifts pitch rather than time-stretching. It is purely a preview control — analysis
 * always reads the source at 1×. The transport drives it with a log slider
 * (`lib/previewSpeed.ts`), which mirrors the core's clamp in `commands/playback.rs`.
 */

/** Trailing debounce before a moved analysis window reloads the looped region, in ms. */
const FOLLOW_DEBOUNCE_MS = 200;

let regionStart = 0;
let regionEnd = 0;
let loopRegion = true;
let startedAt = 0;
/** Whether the loaded region tracks the analysis window (see `previewWindow`). */
let followWindow = false;
let followTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether a preview region is currently loaded/playing (drives the output meter). */
export const [previewPlaying, setPreviewPlaying] = createSignal(false);

/** The varispeed playback rate (1 = real time). Applied on the next region load. */
export const [previewSpeed, setPreviewSpeedSignal] = createSignal(1);

/** Clamp to the range the core honours, treating a non-number as 1×. */
function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

/** Set the preview speed, clamped (kept for the session only). */
export function setPreviewSpeed(value: number) {
  setPreviewSpeedSignal(clampSpeed(value));
}

function issue(start: number, end: number, loop: boolean) {
  void invoke("preview_region", {
    start,
    end,
    loopRegion: loop,
    channel: channelArg(channel()),
    device: outputDeviceId(),
    speed: previewSpeed(),
  }).catch((err) => {
    console.error("preview failed", err);
    setPreviewPlaying(false);
  });
}

/**
 * Play `startSec..endSec` (source seconds), optionally looping. Restarting while
 * already playing replaces the current region (used for drag preview). An explicit
 * `speed` also sets the current rate; `follow` keeps the region on the analysis
 * window (see [`previewWindow`]).
 */
export function previewRegion(
  startSec: number,
  endSec: number,
  loop = true,
  speed?: number,
  follow = false,
) {
  if (speed != null) setPreviewSpeed(speed);
  followWindow = follow;
  cancelFollow();
  regionStart = startSec;
  regionEnd = endSec;
  loopRegion = loop;
  startedAt = performance.now();
  setPreviewPlaying(true);
  issue(startSec, endSec, loop);
}

/**
 * Play `startSec..endSec` and keep the looped region on the analysis window: moving
 * it — by the Timeline's move handle, the chart's Reframe menu, Analyze, or MCP
 * `set_window` — reloads the region once the move settles. An explicit preview range
 * (`previewRegion`) stays where it was.
 */
export function previewWindow(startSec: number, endSec: number, loop = true, speed?: number) {
  previewRegion(startSec, endSec, loop, speed, true);
}

/** Stop any in-flight preview. */
export function stop() {
  cancelFollow();
  followWindow = false;
  setPreviewPlaying(false);
  void invoke("stop_preview");
}

/** Current position within the looped region (seconds), while playing. */
export function playhead(): number | null {
  if (!previewPlaying()) return null;
  const length = regionEnd - regionStart;
  if (length <= 0) return null;
  // A `speed`× region covers `speed`× the source seconds per real second.
  const elapsed = ((performance.now() - startedAt) / 1000) * previewSpeed();
  return regionStart + (elapsed % length);
}

/** Re-load the current region so the core re-reads the filter/channel/device/speed. */
function refreshPreview() {
  if (!previewPlaying()) return;
  if (followWindow) {
    regionStart = windowStart();
    regionEnd = windowEnd();
  }
  startedAt = performance.now();
  issue(regionStart, regionEnd, loopRegion);
}

function cancelFollow() {
  if (followTimer !== undefined) {
    clearTimeout(followTimer);
    followTimer = undefined;
  }
}

/**
 * Reload a window-following preview once the window settles. The core mixes, filters
 * and resamples a region *when it is loaded*, so re-issuing at pointer rate would
 * thrash it and restart the loop on every move; the trailing debounce coalesces a
 * whole drag into one reload, matching the analysis auto-run's settle window.
 */
function followWindowChange() {
  if (!previewPlaying() || !followWindow) return;
  cancelFollow();
  followTimer = setTimeout(() => {
    followTimer = undefined;
    if (!previewPlaying() || !followWindow) return;
    refreshPreview();
  }, FOLLOW_DEBOUNCE_MS);
}

// Re-apply the preview when anything that changes the *loaded* buffer changes, and
// keep a window preview on the window as it moves.
createRoot(() => {
  createEffect(
    on([channel, filterRevision, outputDeviceId, previewSpeed], () => refreshPreview(), {
      defer: true,
    }),
  );
  createEffect(on([windowStart, windowEnd], followWindowChange, { defer: true }));
});
