import { adjustHue, transparentize } from "color2k";

/**
 * The Timeline's derived colours (M23), all computed from the chart theme's `series`
 * colour with **color2k** so a theme's arbitrary CSS colour works without a parser:
 *
 * - **Window shading** — a hue-shifted tint, so the analysis window reads as a *selection*
 *   rather than as more of the same waveform. Memoized per `series` string, because the
 *   Timeline repaints at pointer rate.
 * - **Lane tint** — the non-selected channel lanes are the same colour at reduced alpha.
 * - **Selection fill** — the live rectangle drawn while a window is being dragged out.
 *
 * See `docs/roadmap.md` → M23 → "Parallel channel lanes" and "Window readout, pan and
 * select".
 */

/** Hue rotation (degrees) that separates the window tint from the waveform's own hue. */
const WINDOW_HUE_SHIFT = 42;
/** Alpha removed from the series colour for the window shading (~20% left). */
const WINDOW_FADE = 0.8;
/** Alpha removed for the non-selected channel lanes (~55% left). */
const LANE_FADE = 0.45;
/** Alpha removed for the live window-selection fill (~35% left). */
const SELECT_FADE = 0.65;

export interface TimelineColors {
  /** The analysis window's shading: a distinct hue, subtle enough to read the data through. */
  window: string;
  /** The hue-shifted colour at full alpha — the window handles and selection edges. */
  windowEdge: string;
  /** A non-selected channel lane's waveform. */
  laneDim: string;
  /** The translucent fill of a window being dragged out. */
  selectFill: string;
}

let cachedSeries = "";
let cached: TimelineColors | null = null;

/** Derive the Timeline colours from a theme's `series` colour (memoized per value). */
export function timelineColors(series: string): TimelineColors {
  if (cached && series === cachedSeries) return cached;
  const shifted = adjustHue(series, WINDOW_HUE_SHIFT);
  cachedSeries = series;
  cached = {
    window: transparentize(shifted, WINDOW_FADE),
    windowEdge: shifted,
    laneDim: transparentize(series, LANE_FADE),
    selectFill: transparentize(shifted, SELECT_FADE),
  };
  return cached;
}
