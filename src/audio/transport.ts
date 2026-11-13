/**
 * Pure transport math (M23) — the state vocabulary plus the interpolation the Timeline
 * draws from.
 *
 * The Rust core's cursor is authoritative but polled a few times a second, so the
 * frontend re-anchors on each poll and extends the position locally at the playback
 * speed. This module has no Solid or Tauri imports, so that arithmetic is unit-testable
 * and the transport store (`preview.ts`) stays about commands and lifecycle.
 */

/** A transport state: nothing loaded/playing, playing, or paused at the cursor. */
export type TransportStatus = "idle" | "playing" | "paused";

/** The loaded region, in source seconds. */
export interface TransportRegion {
  start: number;
  end: number;
}

/** Where the last authoritative core position put the line. */
export interface TransportAnchor {
  /** Source seconds. */
  secs: number;
  /** `performance.now()` at the poll. */
  at: number;
}

/** Clamp `value` into `[lo, hi]`. */
export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * The source second to draw now: the authoritative anchor extended by the elapsed real
 * time at `speed`, wrapped inside the region while looping (or stopped at its end when
 * not). Only a playing transport moves; every other state reports the anchor itself.
 */
export function interpolate(opts: {
  status: TransportStatus;
  region: TransportRegion;
  anchor: TransportAnchor;
  speed: number;
  loop: boolean;
  now: number;
}): number {
  const { start, end } = opts.region;
  const length = end - start;
  if (opts.status !== "playing" || length <= 0) return opts.anchor.secs;
  let at = opts.anchor.secs + ((opts.now - opts.anchor.at) / 1000) * opts.speed;
  if (at >= end) {
    if (!opts.loop) return end;
    at = start + ((at - start) % length);
  }
  return Math.max(start, at);
}
