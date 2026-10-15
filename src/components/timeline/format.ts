/**
 * Pure time-formatting and tick-step helpers for the Timeline — no stores or DOM,
 * so they are trivial to unit-test. `formatTime` feeds the toolbar readout;
 * `formatRulerTime` and `niceStep` drive the canvas ruler (`draw.ts`).
 */

/** Ruler tick steps (seconds), smallest-first; `niceStep` picks the first that fits. */
const TICK_STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
  1800, 3600,
];

/** `m:ss.ss`, or the `–:––` placeholder for a non-finite time. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "–:––";
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const minutes = Math.floor(abs / 60);
  const secs = abs - minutes * 60;
  return `${sign}${minutes}:${secs.toFixed(2).padStart(5, "0")}`;
}

/**
 * Compact ruler label. The granularity follows the visible span so consecutive
 * ticks stay short enough not to collide: `h:mm:ss` for long spans, whole-second
 * `m:ss` from a minute up, and `ss.s` / finer for short spans.
 */
export function formatRulerTime(seconds: number, visibleSpan: number): string {
  if (!Number.isFinite(seconds)) return "–:––";
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const secs = Math.floor(abs % 60);
  if (hours > 0 || visibleSpan >= 3600) {
    return `${sign}${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  if (visibleSpan >= 60) {
    return `${sign}${minutes}:${secs.toString().padStart(2, "0")}`;
  }
  if (visibleSpan >= 1) return `${sign}${abs.toFixed(1)}`;
  if (visibleSpan >= 0.1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toFixed(3)}`;
}

/** The smallest tick step (seconds) whose spacing at `width` stays readable. */
export function niceStep(span: number, width: number): number {
  const target = Math.max(1, width / 90);
  for (const step of TICK_STEPS) {
    if (span / step <= target) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}
