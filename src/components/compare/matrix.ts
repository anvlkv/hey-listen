import type { MatrixResult, SpectrogramResult } from "../../state/analyzer";
import { chartTheme } from "../../state/themes";
import type { MatrixDiffDto, Span } from "../../state/compare/types";
import { clamp01 } from "../analyzer/colormap";
import type { PlotBox } from "../analyzer/chartGeometry";
import { hopOf } from "./align";

/**
 * The numeric side of the compare **heatmaps** (M25.A): reading a matrix or spectrogram
 * grid, the shared A/B value range, the Δ image's zero-centred limit and the
 * **diverging ramp** it paints through.
 *
 * Two result shapes reach this module — a generic `MatrixResult` (mel / MFCC / chroma /
 * contrast) and a `SpectrogramResult` — so the accessors hide the field differences
 * rather than forcing the view to branch everywhere. See `docs/comparison.md`.
 */

/** A heatmap result, either generic matrix or spectrogram. */
export type GridResult = MatrixResult | SpectrogramResult;

/** Whether a grid result is a spectrogram (it has `magDb` + `freqs`). */
export function isSpectrogramGrid(result: GridResult): result is SpectrogramResult {
  return "magDb" in result;
}

/** The value at a frame / band of a grid result (bottom-up band index). */
export function gridValue(result: GridResult, frame: number, band: number): number {
  const index = frame * result.bins + band;
  if (isSpectrogramGrid(result)) return result.magDb[index] ?? 0;
  return result.values[index] ?? 0;
}

/** The spectrogram's display floor, in dB below its peak (`SpectrogramTab`'s range). */
export const SPECTROGRAM_DB_RANGE = 80;

/** A shared value range for both sides, so switching A/B never rescales the ramp. */
export function sharedRange(a: GridResult, b: GridResult): { lo: number; hi: number } {
  if (isSpectrogramGrid(a) || isSpectrogramGrid(b)) {
    const peak = (r: GridResult) => (isSpectrogramGrid(r) ? r.maxDb : r.maxValue);
    const hi = Math.max(peak(a), peak(b));
    return { lo: hi - SPECTROGRAM_DB_RANGE, hi };
  }
  return { lo: Math.min(a.minValue, b.minValue), hi: Math.max(a.maxValue, b.maxValue) };
}

/** The span a matched-times matrix column grid covers (adds one hop past the last). */
export function deltaSpan(diff: MatrixDiffDto): Span | null {
  if (diff.times.length === 0) return null;
  const hop = hopOf(diff.times);
  return {
    start: diff.times[0],
    end: diff.times[diff.times.length - 1] + (hop > 0 ? hop : 1e-6),
  };
}

/** The symmetric limit of a Δ heatmap: its largest absolute value, never zero. */
export function deltaLimit(values: readonly number[]): number {
  let limit = 0;
  for (const value of values) {
    if (Number.isFinite(value)) limit = Math.max(limit, Math.abs(value));
  }
  return limit > 0 ? limit : 1e-3;
}

/**
 * Draw an offscreen heatmap into the plot, mapping **source seconds** (not frame
 * indices): `source` is the span the image represents and `at` the axis span. The
 * visible intersection is blitted, so a result whose window pokes outside the axis
 * is cropped rather than squeezed.
 */
export function blitRange(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  at: Span,
  image: HTMLCanvasElement,
  source: Span,
): void {
  if (image.width <= 0 || image.height <= 0) return;
  const total = Math.max(source.end - source.start, 1e-9);
  const from = Math.max(at.start, source.start);
  const to = Math.min(at.end, source.end);
  if (!(to > from) || !(at.end > at.start)) return;
  const sx = ((from - source.start) / total) * image.width;
  const sw = ((to - from) / total) * image.width;
  const dx = box.x + ((from - at.start) / (at.end - at.start)) * box.width;
  const dw = ((to - from) / (at.end - at.start)) * box.width;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, sx, 0, sw, image.height, dx, box.y, dw, box.height);
  ctx.imageSmoothingEnabled = true;
}

// --- diverging ramp ---------------------------------------------------------

/** The cached 256-stop ramp, keyed by the three theme colours it was built from. */
let cacheKey = "";
let cache: Uint8ClampedArray | null = null;

/**
 * A **diverging** colour for a signed Δ (`-1 … +1`): A's colour at the negative pole,
 * the heatmap background at zero, B's colour at the positive pole. Sampled from a
 * canvas gradient once per theme, so a theme file's arbitrary CSS colours work without
 * a colour parser.
 */
export function divergingColor(value: number): [number, number, number] {
  const theme = chartTheme();
  const key = `${theme.compareA}|${theme.spectroBackground}|${theme.compareB}`;
  if (key !== cacheKey) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [0, 0, 0];
    const gradient = ctx.createLinearGradient(0, 0, 256, 0);
    gradient.addColorStop(0, theme.compareA);
    gradient.addColorStop(0.5, theme.spectroBackground);
    gradient.addColorStop(1, theme.compareB);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 1);
    cache = ctx.getImageData(0, 0, 256, 1).data;
    cacheKey = key;
  }
  if (!cache) return [0, 0, 0];
  const index = Math.round(clamp01((value + 1) / 2) * 255) * 4;
  return [cache[index], cache[index + 1], cache[index + 2]];
}
