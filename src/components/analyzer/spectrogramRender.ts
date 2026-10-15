import { formatHz, type SpectrogramResult } from "../../state/analyzer";
import { chartTheme } from "../../state/themes";
import { buildHeatmapImage } from "./chartCanvas";
import type { ChartView, PlotBox } from "./chartGeometry";

/**
 * Spectrogram-specific rendering: the offscreen heatmap image, the spectral
 * centroid / rolloff contours, and the frequency axis. Split out of
 * [`SpectrogramTab`](./SpectrogramTab.tsx) so the component stays a view + wiring
 * and the (numeric, side-effect-free) work lives on its own.
 */

/** The visible spectrogram window: the shared time range plus the frequency band. */
export interface SpectrogramWindow extends ChartView {
  f0: number;
  f1: number;
}

/** Which contours to draw over the heatmap. */
export interface ContourToggles {
  centroid: boolean;
  rolloff: boolean;
}

/** Per-frame spectral contours for a spectrogram result (Hz; `NaN` = empty frame). */
export interface SpectrogramOverlays {
  centroid: Float64Array;
  rolloff: Float64Array;
}

/**
 * Per-frame spectral centroid (centre of mass) and rolloff (85% of the energy
 * below it), in Hz. Derived from the displayed magnitudes so the contours align
 * with the heatmap's frames; `NaN` marks an empty (all-silent) frame.
 */
export function spectrogramOverlays(result: SpectrogramResult | null): SpectrogramOverlays | null {
  if (!result || result.frames === 0 || result.bins === 0) return null;
  const { frames, bins, freqs, magDb } = result;
  const centroid = new Float64Array(frames);
  const rolloff = new Float64Array(frames);
  const power = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    let total = 0;
    for (let b = 0; b < bins; b++) {
      const p = Math.pow(10, magDb[base + b] / 10);
      power[b] = p;
      total += p;
    }
    if (!(total > 0)) {
      centroid[f] = NaN;
      rolloff[f] = NaN;
      continue;
    }
    let weighted = 0;
    for (let b = 0; b < bins; b++) weighted += freqs[b] * power[b];
    centroid[f] = weighted / total;
    const target = 0.85 * total;
    let acc = 0;
    let b = 0;
    for (; b < bins; b++) {
      acc += power[b];
      if (acc >= target) break;
    }
    rolloff[f] = freqs[Math.min(b, bins - 1)];
  }
  return { centroid, rolloff };
}

/** The offscreen frames×bins image (time × frequency), or `null` without data. */
export function spectrogramImage(
  result: SpectrogramResult | null,
  dbRange: number,
): HTMLCanvasElement | null {
  if (!result || result.bins === 0 || result.frames === 0) return null;
  const { bins, frames, magDb } = result;
  const floor = result.maxDb - dbRange;
  const span = Math.max(1e-3, result.maxDb - floor);
  // Time runs horizontally, frequency vertically (a spectrogram's convention).
  return buildHeatmapImage(frames, bins, floor, span, (x, row) => magDb[x * bins + row]);
}

/** Bin index whose centre frequency is closest to `freq`. */
export function binAt(result: SpectrogramResult, freq: number): number {
  const freqs = result.freqs;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < freqs.length; i++) {
    const distance = Math.abs(freqs[i] - freq);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Frequency-axis labels down the plot's left edge. */
export function drawFrequencyAxis(
  ctx: CanvasRenderingContext2D,
  view: SpectrogramWindow,
  box: PlotBox,
): void {
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = chartTheme().axis;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const freq = view.f0 + frac * (view.f1 - view.f0);
    const y = box.y + box.height - frac * box.height;
    ctx.fillText(formatHz(freq), box.x - 6, y);
  }
}

/** Draw the spectral centroid / rolloff contours over the heatmap. */
export function drawContours(
  ctx: CanvasRenderingContext2D,
  view: SpectrogramWindow,
  box: PlotBox,
  windowStart: number,
  duration: number,
  overlays: SpectrogramOverlays | null,
  toggles: ContourToggles,
): void {
  if (!overlays) return;
  const total = Math.max(duration, 1e-9);
  const freqSpan = Math.max(view.f1 - view.f0, 1e-9);
  const timeSpan = Math.max(view.t1 - view.t0, 1e-9);

  const track = (values: Float64Array, color: string) => {
    const count = values.length;
    if (count < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (let f = 0; f < count; f++) {
      const freq = values[f];
      if (!Number.isFinite(freq)) {
        started = false;
        continue;
      }
      const time = windowStart + ((f + 0.5) / count) * total;
      const x = box.x + ((time - view.t0) / timeSpan) * box.width;
      const y = box.y + box.height - ((freq - view.f0) / freqSpan) * box.height;
      if (started) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        started = true;
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  if (toggles.centroid) track(overlays.centroid, chartTheme().overlayCentroid);
  if (toggles.rolloff) track(overlays.rolloff, chartTheme().overlayRolloff);
}
