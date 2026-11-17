import type { MatrixResult, SpectrogramResult } from "../../state/analyzer";
import { mix, parseToRgba } from "color2k";
import { chartTheme } from "../../state/themes";
import type { MatrixDiffDto, Span } from "../../state/compare/types";
import { clamp01 } from "../analyzer/colormap";
import { SPECTROGRAM_DB_RANGE } from "../analyzer/spectrogramView";
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

/** Steps in the cached Δ ramp: a match for the 8-bit output the heatmap writes. */
const RAMP_STEPS = 256;

/** The cached Δ ramp (RGB triples), keyed by the three theme colours it was built from. */
let cacheKey = "";
let cache: Uint8Array | null = null;

/** One hue of the Δ ramp: the background at zero, A or B at the poles (color2k `mix`). */
function poleColor(theme: ReturnType<typeof chartTheme>, at: number): [number, number, number] {
  const color =
    at <= 0.5
      ? mix(theme.spectroBackground, theme.compareA, 1 - at * 2)
      : mix(theme.spectroBackground, theme.compareB, at * 2 - 1);
  const [r, g, b] = parseToRgba(color);
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/**
 * A **diverging** colour for a signed Δ (`-1 … +1`): A's colour at the negative pole,
 * the heatmap background at zero, B's colour at the positive pole. The A→background→B
 * ramp is built once per theme with color2k (so a theme file's arbitrary CSS colours
 * work) and cached as a 256-step table, because the Δ heatmap samples it per pixel.
 */
export function divergingColor(value: number): [number, number, number] {
  const theme = chartTheme();
  const key = `${theme.compareA}|${theme.spectroBackground}|${theme.compareB}`;
  let table = cache;
  if (key !== cacheKey || !table) {
    table = new Uint8Array(RAMP_STEPS * 3);
    for (let i = 0; i < RAMP_STEPS; i++) {
      const [r, g, b] = poleColor(theme, i / (RAMP_STEPS - 1));
      table[i * 3] = r;
      table[i * 3 + 1] = g;
      table[i * 3 + 2] = b;
    }
    cache = table;
    cacheKey = key;
  }
  const index = Math.round(clamp01((value + 1) / 2) * (RAMP_STEPS - 1)) * 3;
  return [table[index], table[index + 1], table[index + 2]];
}
