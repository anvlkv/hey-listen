import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { channel, channelArg } from "../state/analysis";
import { filterRevision } from "../state/graph";
import { outputDeviceId } from "../state/output";

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
 */

let regionStart = 0;
let regionEnd = 0;
let loopRegion = true;
let startedAt = 0;

/** Whether a preview region is currently loaded/playing (drives the output meter). */
export const [previewPlaying, setPreviewPlaying] = createSignal(false);

function issue(start: number, end: number, loop: boolean) {
  void invoke("preview_region", {
    start,
    end,
    loopRegion: loop,
    channel: channelArg(channel()),
    device: outputDeviceId(),
  }).catch((err) => {
    console.error("preview failed", err);
    setPreviewPlaying(false);
  });
}

/**
 * Play `startSec..endSec` (source seconds), optionally looping. Restarting while
 * already playing replaces the current region (used for drag preview).
 */
export function previewRegion(startSec: number, endSec: number, loop = true) {
  regionStart = startSec;
  regionEnd = endSec;
  loopRegion = loop;
  startedAt = performance.now();
  setPreviewPlaying(true);
  issue(startSec, endSec, loop);
}

/** Stop any in-flight preview. */
export function stop() {
  setPreviewPlaying(false);
  void invoke("stop_preview");
}

/** Current position within the looped region (seconds), while playing. */
export function playhead(): number | null {
  if (!previewPlaying()) return null;
  const length = regionEnd - regionStart;
  if (length <= 0) return null;
  return regionStart + (((performance.now() - startedAt) / 1000) % length);
}

/** Re-load the current region so the core re-reads the filter/channel/device. */
function refreshPreview() {
  if (!previewPlaying()) return;
  startedAt = performance.now();
  issue(regionStart, regionEnd, loopRegion);
}

// Re-apply the preview when anything that changes the *loaded* buffer changes.
createRoot(() => {
  createEffect(
    on([channel, filterRevision, outputDeviceId], () => refreshPreview(), { defer: true }),
  );
});
