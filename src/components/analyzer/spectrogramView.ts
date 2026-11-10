import { clampTimeRange, type ChartView } from "./chartGeometry";
import { displayToHz, hzToDisplay, type FrequencyScale } from "./frequencyScale";
import type { SpectrogramResult } from "../../state/analyzer";

/**
 * The spectrogram's **view** math: the visible time × frequency window and the
 * pointer/zoom mapping between its Hz bounds and the plot's vertical fractions.
 *
 * It lives apart from [`spectrogramRender`](./spectrogramRender.ts) (drawing) and from
 * [`SpectrogramTab`](./SpectrogramTab.tsx) (wiring), and is shared with the linked
 * waveform-over-spectrogram pair so both canvases pan and zoom identically.
 *
 * The window's frequency bounds stay in **physical Hz**; every fraction is taken in the
 * chart's **display coordinate** (`hzToDisplay`), so a Bark / ERB / log axis zooms and
 * picks where it is drawn, not where it would be on a linear axis. See `frequencyScale.ts`.
 */

/**
 * The spectrogram's default display floor, in dB below its peak (the colour range).
 *
 * It lives here, with the view math, because both the canvas view and the compare
 * heatmaps read it — importing it from the drawing module would drag a canvas/chart-bus
 * dependency into the browser-free unit suites.
 */
export const SPECTROGRAM_DB_RANGE = 80;

/** The visible spectrogram window: the shared time range plus the frequency band (Hz). */
export interface SpectrogramWindow extends ChartView {
  f0: number;
  f1: number;
}

/** The full (unzoomed) view for a result. */
export function fullView(result: SpectrogramResult): SpectrogramWindow {
  const f0 = result.freqs[0] ?? 0;
  const f1 = result.freqs.length ? result.freqs[result.freqs.length - 1] : result.sampleRate / 2;
  return {
    t0: result.windowStart,
    t1: result.windowStart + Math.max(result.duration, 1e-6),
    f0,
    f1: Math.max(f1, f0 + 1),
  };
}

/** The band's bottom/top in the display coordinate. */
function band(view: SpectrogramWindow, scale: FrequencyScale): [number, number] {
  return [hzToDisplay(scale, view.f0), hzToDisplay(scale, view.f1)];
}

/** Keep a proposed view inside the data extent and above a minimum span. */
export function clampView(next: SpectrogramWindow, result: SpectrogramResult): SpectrogramWindow {
  const [t0, t1] = clampTimeRange(next.t0, next.t1, result.windowStart, result.duration);

  const fLo = result.freqs[0] ?? 0;
  const fHiRaw = result.freqs.length
    ? result.freqs[result.freqs.length - 1]
    : result.sampleRate / 2;
  const fHi = Math.max(fHiRaw, fLo + 1);
  const minF = Math.max((fHi - fLo) * 1e-4, 1e-3);
  let f0 = Math.max(fLo, Math.min(next.f0, fHi));
  let f1 = Math.max(fLo, Math.min(next.f1, fHi));
  if (f1 - f0 < minF) f1 = f0 + minF;
  if (f1 > fHi) {
    f1 = fHi;
    f0 = Math.max(fLo, f1 - minF);
  }
  return { t0, t1, f0, f1 };
}

/** The frequency at a plot-relative height fraction (0 = bottom, 1 = top), in Hz. */
export function freqAtFrac(view: SpectrogramWindow, frac: number, scale: FrequencyScale): number {
  const [lo, hi] = band(view, scale);
  return displayToHz(scale, lo + frac * (hi - lo));
}

/** The plot-relative height fraction (0 = bottom) of a frequency. */
export function fracAtFreq(view: SpectrogramWindow, hz: number, scale: FrequencyScale): number {
  const [lo, hi] = band(view, scale);
  return hi > lo ? (hzToDisplay(scale, hz) - lo) / (hi - lo) : 0;
}

/** Pan the band by a fraction of its displayed height (positive = towards higher frequencies). */
export function panBand(
  view: SpectrogramWindow,
  dyFrac: number,
  scale: FrequencyScale,
): SpectrogramWindow {
  const [lo, hi] = band(view, scale);
  const shift = dyFrac * (hi - lo);
  return {
    ...view,
    f0: displayToHz(scale, lo + shift),
    f1: displayToHz(scale, hi + shift),
  };
}

/** Zoom the band by `factor` around a plot-relative height fraction. */
export function zoomBand(
  view: SpectrogramWindow,
  yFrac: number,
  factor: number,
  scale: FrequencyScale,
): SpectrogramWindow {
  const [lo, hi] = band(view, scale);
  const at = lo + yFrac * (hi - lo);
  return {
    ...view,
    f0: displayToHz(scale, at + (lo - at) * factor),
    f1: displayToHz(scale, at + (hi - at) * factor),
  };
}
