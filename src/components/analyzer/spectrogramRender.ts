import { formatHz, type SpectrogramResult } from "../../state/analyzer";
import { chartTheme } from "../../state/themes";
import { buildHeatmapImage, strokeOverRamp } from "./chartCanvas";
import type { HeatmapScale } from "./heatmapScale";
import { displayToHz, hzToDisplay, type FrequencyScale } from "./frequencyScale";
import { fracAtFreq, freqAtFrac, type SpectrogramWindow } from "./spectrogramView";
import type { PlotBox } from "./chartGeometry";

/**
 * Spectrogram-specific rendering: the offscreen heatmap image, the spectral
 * centroid / rolloff / pitch contours, the band boundaries and the frequency axis.
 * Split out of [`SpectrogramTab`](./SpectrogramTab.tsx) so the component stays a view +
 * wiring and the (numeric, side-effect-free) work lives on its own. The view math it
 * reads (`SpectrogramWindow`, the Hz ↔ fraction mapping) is in
 * [`spectrogramView`](./spectrogramView.ts).
 */

/**
 * The engine's `DB_FLOOR` (`analysis/mod.rs`). dB values are clamped here, so an
 * all-silent frame still converts to a positive linear power; silence must be judged
 * against this floor, not against `power > 0`.
 */
const SPECTROGRAM_FLOOR_DB = -120;

/** Which contours to draw over the heatmap. */
export interface ContourToggles {
  centroid: boolean;
  rolloff: boolean;
  /** Draw the composed pitch track (present when the caller supplies a `PitchOverlay`). */
  pitch?: boolean;
  /** Draw the pitch track's harmonic multiples. */
  harmonics?: boolean;
}

/** A pitch track composed for the same window (Phase 2) — never inferred from the heatmap. */
export interface PitchOverlay {
  /** Frame-aligned F0 in Hz (`NaN` = unvoiced), the same length as the heatmap's frames. */
  f0: Float64Array;
  /** Harmonic frequencies (Hz) to mark as rules. */
  harmonics: number[];
}

/** Per-frame spectral overlays for a spectrogram result (Hz; `NaN` = empty frame). */
export interface SpectrogramOverlays {
  centroid: Float64Array;
  rolloff: Float64Array;
  /**
   * The F0 track, when a `PitchResult` for the same window has been composed. `null`
   * until then: F0 is **not** derivable from the centroid/rolloff the heatmap carries.
   */
  pitch: Float64Array | null;
  /** The pitch track's harmonic multiples, in Hz (`null` with `pitch`). */
  harmonics: number[] | null;
}

/**
 * Per-frame spectral centroid (centre of mass) and rolloff (85% of the energy
 * below it), in Hz. Derived from the displayed magnitudes so the contours align
 * with the heatmap's frames; `NaN` marks an empty (all-silent) frame.
 */
export function spectrogramOverlays(
  result: SpectrogramResult | null,
  pitch: PitchOverlay | null = null,
): SpectrogramOverlays | null {
  if (!result || result.frames === 0 || result.bins === 0) return null;
  const { frames, bins, freqs, magDb } = result;
  const centroid = new Float64Array(frames);
  const rolloff = new Float64Array(frames);
  const power = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    let total = 0;
    let peakDb = -Infinity;
    for (let b = 0; b < bins; b++) {
      const db = magDb[base + b];
      if (db > peakDb) peakDb = db;
      const p = Math.pow(10, db / 10);
      power[b] = p;
      total += p;
    }
    // A floor-level frame has positive power (`10^(-120/10)`), so `total > 0` is
    // always true; the frame is silent when its peak is at or below the sentinel.
    if (!(peakDb > SPECTROGRAM_FLOOR_DB)) {
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
  return { centroid, rolloff, pitch: pitch?.f0 ?? null, harmonics: pitch?.harmonics ?? null };
}

/**
 * The source bin each **output** row samples, one row per bin.
 *
 * FFT rows are uniform in Hz, so a rectangular `drawImage` stretch is only correct for a
 * linear axis: on a log / Bark / ERB axis the rows must be resampled into display
 * coordinates, otherwise the picture and the axis labels disagree. The bins ascend, so
 * the nearest one advances monotonically with the output row — one pass, no search.
 */
function rowBins(result: SpectrogramResult, scale: FrequencyScale): Int32Array {
  const { bins, freqs } = result;
  const lo = hzToDisplay(scale, freqs[0] ?? 0);
  const hi = hzToDisplay(scale, freqs[bins - 1] ?? 0);
  const rows = new Int32Array(bins);
  let bin = 0;
  for (let row = 0; row < bins; row++) {
    const at = bins > 1 ? lo + (row / (bins - 1)) * (hi - lo) : lo;
    const hz = displayToHz(scale, at);
    while (
      bin + 1 < bins &&
      Math.abs((freqs[bin + 1] ?? 0) - hz) <= Math.abs((freqs[bin] ?? 0) - hz)
    ) {
      bin++;
    }
    rows[row] = bin;
  }
  return rows;
}

/**
 * The offscreen frames×bins image (time ×, frequency ↑), resampled into `scale`.
 *
 * The level axis is the **display floor** (`maxDb − dbRange … maxDb`), resolved by the
 * caller into a [`HeatmapScale`](./heatmapScale.ts) so the image and the colourbar use
 * exactly that domain and ramp — the bar cannot silently disagree with the pixels.
 */
export function spectrogramImage(
  result: SpectrogramResult | null,
  scale: HeatmapScale,
  frequencyScale: FrequencyScale,
): HTMLCanvasElement | null {
  if (!result || result.bins === 0 || result.frames === 0) return null;
  const { bins, frames, magDb } = result;
  const rows = rowBins(result, frequencyScale);
  // Time runs horizontally, frequency vertically (a spectrogram's convention).
  return buildHeatmapImage(
    frames,
    bins,
    0,
    1,
    (x, row) => scale.position(magDb[x * bins + rows[row]]),
    scale.ramp,
  );
}

/**
 * The source image sub-rectangle of the offscreen image that covers the visible band.
 * Because the image's rows are already in display coordinates, this is the same simple
 * sub-rectangle for every scale — the resampling happened in [`spectrogramImage`].
 */
export function visibleRows(
  result: SpectrogramResult,
  view: SpectrogramWindow,
  scale: FrequencyScale,
): { sy: number; sh: number } {
  const rows = Math.max(1, result.bins);
  const lo = hzToDisplay(scale, result.freqs[0] ?? 0);
  const hi = hzToDisplay(scale, result.freqs[result.bins - 1] ?? 0);
  /** A frequency's fractional **bottom-up** row in the image. */
  const at = (hz: number) => {
    const u = hzToDisplay(scale, hz);
    return hi > lo ? ((u - lo) / (hi - lo)) * (rows - 1) : 0;
  };
  const clampRow = (row: number) => Math.min(Math.max(row, 0), rows - 1);
  const bottom = clampRow(at(view.f0));
  const top = clampRow(at(view.f1));
  // Inclusive: a row's pixel spans one unit, so the band covers one row more than the
  // difference between the two boundary rows.
  const sh = Math.max(1e-3, top - bottom + 1);
  // Image row 0 is the highest frequency, so the source y is inverted.
  return { sy: rows - 1 - top, sh };
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

/** Frequency-axis labels down the plot's left edge (Hz; the axis follows `scale`). */
export function drawFrequencyAxis(
  ctx: CanvasRenderingContext2D,
  view: SpectrogramWindow,
  box: PlotBox,
  scale: FrequencyScale,
): void {
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = chartTheme().axis;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
    const freq = freqAtFrac(view, frac, scale);
    const y = box.y + box.height - frac * box.height;
    ctx.fillText(formatHz(freq), box.x - 6, y);
  }
}

/** Draw the centroid / rolloff contours, the pitch track and its harmonics. */
export function drawContours(
  ctx: CanvasRenderingContext2D,
  view: SpectrogramWindow,
  box: PlotBox,
  windowStart: number,
  duration: number,
  overlays: SpectrogramOverlays | null,
  toggles: ContourToggles,
  scale: FrequencyScale,
): void {
  if (!overlays) return;
  const total = Math.max(duration, 1e-9);
  const timeSpan = Math.max(view.t1 - view.t0, 1e-9);

  const yFor = (freq: number) => box.y + box.height - fracAtFreq(view, freq, scale) * box.height;

  /** One polyline over the frames, clipped to the plot and haloed for the ramp. */
  const track = (values: Float64Array, color: string, dash: number[] = []) => {
    const count = values.length;
    if (count < 2) return;
    const path = new Path2D();
    let started = false;
    for (let f = 0; f < count; f++) {
      const freq = values[f];
      if (!Number.isFinite(freq)) {
        started = false;
        continue;
      }
      const time = windowStart + ((f + 0.5) / count) * total;
      const x = box.x + ((time - view.t0) / timeSpan) * box.width;
      const y = yFor(freq);
      if (started) path.lineTo(x, y);
      else {
        path.moveTo(x, y);
        started = true;
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    strokeOverRamp(ctx, path, color, 1.25, dash);
    ctx.restore();
  };

  if (toggles.centroid) track(overlays.centroid, chartTheme().overlayCentroid);
  if (toggles.rolloff) track(overlays.rolloff, chartTheme().overlayRolloff);

  // A composed pitch track (Phase 2) rides the same haloed path, dashed so it reads
  // apart from the centroid / rolloff lines it shares the plot with.
  if (toggles.pitch && overlays.pitch) {
    track(overlays.pitch, chartTheme().markerBeat, [4, 3]);
  }
  if (toggles.harmonics && overlays.harmonics && overlays.harmonics.length > 0) {
    const theme = chartTheme();
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    for (const hz of overlays.harmonics) {
      const y = yFor(hz);
      if (!Number.isFinite(y) || y < box.y || y > box.y + box.height) continue;
      const path = new Path2D();
      const py = Math.round(y) + 0.5;
      path.moveTo(box.x, py);
      path.lineTo(box.x + box.width, py);
      strokeOverRamp(ctx, path, theme.markerBeat, 1, [2, 4]);
    }
    ctx.restore();
  }
}
