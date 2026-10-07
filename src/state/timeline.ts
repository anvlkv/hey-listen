import { createSignal } from "solid-js";

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
