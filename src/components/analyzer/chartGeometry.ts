/**
 * Geometry shared by the plain-canvas heatmaps (`MatrixView` / `SpectrogramTab`):
 * the plot margins, the view/box shapes, and the pure math that maps between
 * pixels, time and frames. Kept separate from [`chartInteraction`](./chartInteraction.ts)
 * so the drawing modules can use it without pulling in the interaction state.
 *
 * Times here are **source seconds** (see `docs/analysis-tools.md`): a result's
 * `times` / its frame grid start at `windowStart`, not at 0, so anything that maps a
 * time back onto a frame needs that origin.
 */

/** Plot margins (px) inside a heatmap canvas: room for the axis labels. */
export const MARGIN = { left: 66, right: 8, top: 8, bottom: 22 };

/** The visible view of a time-axis chart (seconds). */
export interface ChartView {
  t0: number;
  t1: number;
}

/** A canvas plot area, in CSS pixels. */
export interface PlotBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A canvas size, in CSS pixels. */
export interface ChartSize {
  width: number;
  height: number;
}

/** The minimum an analysis result must expose to drive the time interaction. */
export interface TimeExtent {
  /** The window's span, in seconds. */
  duration: number;
  /** Source seconds where the window starts (the frame grid is anchored here). */
  windowStart: number;
}

/** The plot area inside a canvas of `size`. */
export function plotBox(size: ChartSize): PlotBox {
  const { width, height } = size;
  return {
    x: MARGIN.left,
    y: MARGIN.top,
    width: Math.max(1, width - MARGIN.left - MARGIN.right),
    height: Math.max(1, height - MARGIN.top - MARGIN.bottom),
  };
}

/** Clamp a time range to the result's window, keeping at least a hairline span. */
export function clampTimeRange(
  t0: number,
  t1: number,
  windowStart: number,
  duration: number,
): [number, number] {
  const span = Math.max(duration, 1e-9);
  const end = windowStart + span;
  const minT = span * 1e-4;
  let lo = Math.max(windowStart, Math.min(t0, end));
  let hi = Math.max(windowStart, Math.min(t1, end));
  if (hi - lo < minT) hi = lo + minT;
  if (hi > end) {
    hi = end;
    lo = Math.max(windowStart, hi - minT);
  }
  return [lo, hi];
}

/** The frame index nearest a **source** time, clamped to `[0, frames - 1]`. */
export function frameIndex(
  timeSecs: number,
  windowStart: number,
  duration: number,
  frames: number,
): number {
  const into = (timeSecs - windowStart) / Math.max(duration, 1e-9);
  return Math.min(frames - 1, Math.max(0, Math.round(into * frames - 0.5)));
}

/** True when a result holds a non-empty frames × bins grid. */
export function hasFrameData(result: { frames: number; bins: number } | null): boolean {
  return !!result && result.frames > 0 && result.bins > 0;
}

/** The pointer's plot-relative geometry, for mapping a hit to a time / band. */
export interface PlotGeo<V extends ChartView> {
  view: V;
  box: PlotBox;
  /** Pointer position relative to the canvas (px). */
  x: number;
  y: number;
  /** The time under the pointer (s). */
  time: number;
  /** Pointer height above the plot bottom, as a fraction of the plot height. */
  yFrac: number;
}

/** The pointer's plot-relative geometry, or `null` outside the plot area. */
export function plotGeo<V extends ChartView>(
  canvas: HTMLCanvasElement,
  box: PlotBox,
  view: V,
  clientX: number,
  clientY: number,
): PlotGeo<V> | null {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) return null;
  return {
    view,
    box,
    x,
    y,
    time: view.t0 + ((x - box.x) / box.width) * (view.t1 - view.t0),
    yFrac: (box.y + box.height - y) / box.height,
  };
}
