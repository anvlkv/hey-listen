import { batch, createSignal } from "solid-js";
import { source } from "./source";

/**
 * Timeline state, shared across regions (the analyzer tabs in M4+ read the same
 * window). Times are in **seconds**.
 */

/** The analysis window `start..end`. */
export const [windowStart, setWindowStart] = createSignal(0);
export const [windowEnd, setWindowEnd] = createSignal(0);

/** The visible time range of the timeline (zoom/pan). */
export const [viewStart, setViewStart] = createSignal(0);
export const [viewEnd, setViewEnd] = createSignal(0);

/** Reset window + viewport to cover a freshly opened source. */
export function resetTimeline(duration: number) {
  setWindowStart(0);
  setWindowEnd(duration);
  setViewStart(0);
  setViewEnd(duration);
}

export function setView(a: number, b: number) {
  setViewStart(a);
  setViewEnd(b);
}

/** Padding added around a framed window, as a fraction of its length. */
const FRAME_PAD = 0.12;
/** The view is left alone once the window fills this much of it. */
const FRAME_FILL = 0.55;

/**
 * Write the analysis window, optionally **framing** it (M23).
 *
 * Both ends are clamped to `[0, duration]` and written in one transaction; with
 * `frame`, the viewport expands to contain the window plus ~12% padding — unless the
 * window already fills most of the visible span, so a gesture that selected roughly what
 * the user was looking at never disturbs their zoom. The Timeline's selection drag and its
 * edge-drag release are the first callers
 * focus").
 */
export function reframeWindow(opts: { start: number; end: number; frame?: boolean }) {
  const duration = source()?.duration ?? 0;
  const lo = Math.max(0, Math.min(duration, Math.min(opts.start, opts.end)));
  const hi = Math.max(lo, Math.min(duration, Math.max(opts.start, opts.end)));
  batch(() => {
    setWindowStart(lo);
    setWindowEnd(hi);
  });
  if (!opts.frame) return;

  const span = Math.max(1e-9, viewEnd() - viewStart());
  const visible = lo >= viewStart() && hi <= viewEnd();
  if (visible && hi - lo >= span * FRAME_FILL) return;
  // ~12% of the window, with a floor so a minimum-length selection cannot collapse the
  // view onto a fraction of a second.
  const pad = Math.max((hi - lo) * FRAME_PAD, duration * 0.005);
  setView(Math.max(0, lo - pad), Math.min(duration, hi + pad));
}
