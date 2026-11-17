/**
 * The Timeline's text-like **window selection** (M23): pure helpers for the span a
 * primary-button drag selects and the channel lane it starts in. Used by the pointer
 * interaction (`interaction.ts`) and unit-tested on its own, so the clamp /
 * minimum-length / lane rules have one owner. See `docs/roadmap.md` → M23 → "Window
 * readout, pan and select".
 */
import { laneAtY } from "./waveformLanes";

/** A window being selected, in source seconds. */
export interface WindowSpan {
  start: number;
  end: number;
}

/** The smallest analysis window, in seconds: four samples, never under 1 ms. */
export function minWindowFor(sampleRate: number | undefined): number {
  return Math.max(1e-3, sampleRate ? 4 / sampleRate : 1e-3);
}

/**
 * The channel lane under a pointer y, or `null` for a mono source (which has no lanes).
 * A drag that starts in a lane analyses that channel: `SharedParams.channel` is one pick
 * (a channel or `"mix"`), so true multi-channel selection is out of scope.
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
 * same way a text selection keeps its start.
 */
export function selectWindow(
  anchor: number,
  pointer: number,
  duration: number,
  minWindow: number,
): WindowSpan {
  const clamp = (t: number) => Math.max(0, Math.min(duration, t));
  const a = clamp(anchor);
  const b = clamp(pointer);
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
