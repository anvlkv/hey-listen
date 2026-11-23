/**
 * The Timeline's window **arithmetic** (M23): pure helpers for the span a primary-button
 * drag selects, the channel lane it starts in, the time clamp the gestures share and the
 * start of a moved window. Used by the pointer interaction (`interaction.ts`), the snap
 * rules (`snapping.ts`), the context menu (D-11) and unit-tested on its own, so the clamp /
 * minimum-length / lane rules have one owner. See `docs/roadmap.md` → M23 → "Window
 * readout, pan and select".
 */
import { laneAtY } from "./waveformLanes";

/** A window being selected, in source seconds. */
export interface WindowSpan {
  start: number;
  end: number;
}

/** `t` clamped to `[0, duration]`; a non-finite time reads 0. */
export function clampTime(t: number, duration: number): number {
  return Number.isFinite(t) ? Math.max(0, Math.min(duration, t)) : 0;
}

/** The smallest analysis window, in seconds: four samples, never under 1 ms. */
export function minWindowFor(sampleRate: number | undefined): number {
  return Math.max(1e-3, sampleRate ? 4 / sampleRate : 1e-3);
}

/**
 * The channel lane under a pointer y, or `null` when the timeline draws a single lane.
 * A drag that starts in a lane analyses that channel: `SharedParams.channel` is one pick
 * (a channel or `"mix"`), so true multi-channel selection is out of scope. `channels` is
 * the number of **shown** lanes — the filter graph's output channels when it declares
 * several, otherwise the source's channels (see `Timeline.tsx`).
 */
export function channelLaneAt(
  y: number,
  top: number,
  height: number,
  channels: number,
): number | null {
  return channels >= 2 ? laneAtY(y, top, height, channels) : null;
}

/**
 * The window a drag selects: the span between `anchor` and `pointer` in **either**
 * direction, clamped to `[0, duration]`, and never shorter than `minWindow`. When the raw
 * span is too short, the end away from the anchor grows, so the anchor stays put — the
 * same way a text selection keeps its start. The pointer handling never moves the window
 * before the pointer actually moves, so a plain click leaves it untouched.
 */
export function selectWindow(
  anchor: number,
  pointer: number,
  duration: number,
  minWindow: number,
): WindowSpan {
  const a = clampTime(anchor, duration);
  const b = clampTime(pointer, duration);
  let start = Math.min(a, b);
  let end = Math.max(a, b);
  if (end - start < minWindow) {
    if (b >= a) {
      end = Math.min(duration, start + minWindow);
      // At the source end there is no room to grow forwards; grow backwards instead.
      if (end - start < minWindow) start = Math.max(0, end - minWindow);
    } else {
      start = Math.max(0, end - minWindow);
      if (end - start < minWindow) end = Math.min(duration, start + minWindow);
    }
  }
  return { start, end };
}

/**
 * The start of a window moved by `delta` seconds, kept inside `[0, duration - width]` so the
 * whole window stays over the source. The Timeline's move drag applies the pointer delta
 * through this and then hands the result to the (optional) snap, which keeps the width.
 */
export function moveWindow(start: number, delta: number, width: number, duration: number): number {
  const maxStart = Math.max(0, duration - width);
  return Math.max(0, Math.min(maxStart, start + delta));
}
