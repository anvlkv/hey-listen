/**
 * The Timeline canvas's screen-reader copy (D-14): pure strings, no stores and no DOM, so
 * what a screen reader says is unit-testable. `timeline/accessibility.ts` owns the live
 * region and the keyboard map; these three helpers only turn numbers into sentences, and
 * `formatTime` keeps the announced values identical to the toolbar's readout.
 */

import { formatTime } from "./format";

/** Seconds to two decimals, and `0.00` for a non-finite value. */
function formatDuration(seconds: number): string {
  return Number.isFinite(seconds) ? Math.max(0, seconds).toFixed(2) : "0.00";
}

/** "Analysis window 0:01.20 to 0:02.30, 1.10 seconds." */
export function windowAnnouncement(start: number, end: number): string {
  const from = formatTime(start);
  const to = formatTime(end);
  return `Analysis window ${from} to ${to}, ${formatDuration(end - start)} seconds.`;
}

/** "Playhead at 0:01.20." */
export function playheadAnnouncement(seconds: number): string {
  return `Playhead at ${formatTime(seconds)}.`;
}

/** One arrow-key nudge: ~1% of the visible span, floored at 1 ms. */
export function nudgeStep(span: number): number {
  const step = Number.isFinite(span) ? span * 0.01 : 0;
  return Math.max(0.001, step);
}
