import { createSignal } from "solid-js";
import { clampTime } from "./selection";

/**
 * The Timeline's **snapping** (D-12): pure target/tolerance arithmetic for the pointer
 * gestures, plus the on/off signal the context menu toggles. Nothing here reads a store, so
 * the rules unit-test without a DOM (`src/tests/timelineSnapping.test.ts`).
 *
 * A gesture snaps only while [`snapEnabled`] is true: `Timeline.tsx` then hands
 * `interaction.ts` snapped values and otherwise the identity, so an off toggle leaves the
 * original pointer behaviour exactly as it was. Snapping is **off by default** — the
 * Timeline's job is a precisely hand-placed window, and an assist nobody switched on would
 * move it.
 */

/** Whether gestures snap to the candidates and the ruler grid (default **off**). */
export const [snapEnabled, setSnapEnabled] = createSignal(false);

/** What one gesture snaps against. */
export interface SnapOptions {
  /** Snap targets: playhead, window edges, annotation anchors/edges, 0 and the source end. */
  candidates: readonly number[];
  /** Seconds within which a candidate wins (inclusive). */
  tolerance: number;
  /** Zoom-dependent grid step (seconds), used when no candidate is close enough. */
  grid: number;
  duration: number;
}

/** The nearest candidate within the tolerance, or `null`; a tie keeps the earlier one. */
function nearestCandidate(t: number, opts: SnapOptions): number | null {
  let best: number | null = null;
  let distance = opts.tolerance;
  for (const candidate of opts.candidates) {
    if (!Number.isFinite(candidate)) continue;
    const gap = Math.abs(candidate - t);
    if (gap <= distance) {
      best = candidate;
      distance = gap;
    }
  }
  return best;
}

/**
 * Snap one time to the nearest candidate (within `tolerance`), else the nearest grid line.
 * The result is clamped to the source and snapping is idempotent: re-snapping a snapped
 * value returns it again, so a gesture never drifts along the grid.
 */
export function snapTime(t: number, opts: SnapOptions): number {
  const time = clampTime(t, opts.duration);
  const candidate = nearestCandidate(time, opts);
  if (candidate != null) return clampTime(candidate, opts.duration);
  // Rounding (rather than adding steps) is what keeps repeated snaps from accumulating.
  if (!Number.isFinite(opts.grid) || opts.grid <= 0) return time;
  return clampTime(Math.round(time / opts.grid) * opts.grid, opts.duration);
}

/** Snap two ends of a span independently (ordered + clamped). */
export function snapSpan(a: number, b: number, opts: SnapOptions): { start: number; end: number } {
  const start = snapTime(a, opts);
  const end = snapTime(b, opts);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

/** Snap a moving window by its nearer edge, preserving its width inside the source. */
export function snapMove(start: number, width: number, opts: SnapOptions): number {
  const snappedStart = snapTime(start, opts);
  const snappedEnd = snapTime(start + width, opts);
  // The edge that had to travel less wins, so the window lands on the target the user aimed at.
  const startWins = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - (start + width));
  const moved = startWins ? snappedStart : snappedEnd - width;
  const maxStart = Math.max(0, opts.duration - width);
  return Math.max(0, Math.min(maxStart, moved));
}
