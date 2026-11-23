import { stopFollowing } from "./capture";
import { source } from "./source";
import { setView, viewEnd, viewStart, windowEnd, windowStart } from "./timeline";

/**
 * Store-level timeline zoom.
 * The Timeline's wheel gesture stays local (it needs canvas geometry), but the toolbar
 * buttons and the `timeline.*` commands share these actions.
 */

/** Smallest visible span, so a fully zoomed-in view never collapses to zero. */
const MIN_SPAN_FLOOR = 1e-4;
/** Divisor giving the minimum span as a fraction of the source. */
const MIN_SPAN_DIVISOR = 100_000;

/**
 * Clamp `a..b` into `0..duration`, keeping a minimum span and shifting (never shrinking)
 * a range that ran off an edge. The exact clamp the Timeline has always applied.
 */
export function clampViewRange(a: number, b: number, duration: number): [number, number] {
  const minSpan = Math.min(duration, Math.max(MIN_SPAN_FLOOR, duration / MIN_SPAN_DIVISOR));
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  if (lo < 0) {
    hi = Math.min(duration, hi - lo);
    lo = 0;
  }
  if (hi > duration) {
    lo = Math.max(0, lo - (hi - duration));
    hi = duration;
  }
  return [Math.max(0, lo), Math.min(duration, hi)];
}

/** Clamp against the current source and write the view. */
function applyView(a: number, b: number) {
  const [lo, hi] = clampViewRange(a, b, source()?.duration ?? 0);
  setView(lo, hi);
}

/** Zoom around the centre of the visible span by `factor` (`< 1` zooms in). */
export function zoomBy(factor: number) {
  stopFollowing();
  const center = (viewStart() + viewEnd()) / 2;
  applyView(center + (viewStart() - center) * factor, center + (viewEnd() - center) * factor);
}

/** Zoom in by one step. */
export function zoomIn() {
  zoomBy(1 / 1.5);
}

/** Zoom out by one step. */
export function zoomOut() {
  zoomBy(1.5);
}

/** Frame the analysis window with ~5% padding. */
export function zoomToWindow() {
  stopFollowing();
  const duration = source()?.duration ?? 0;
  const windowDuration = windowEnd() - windowStart();
  const pad = Math.max(windowDuration * 0.05, 1e-3);
  applyView(Math.max(0, windowStart() - pad), Math.min(duration, windowEnd() + pad));
}

/** Fit the whole source into the view. */
export function fitAll() {
  stopFollowing();
  applyView(0, source()?.duration ?? 0);
}
