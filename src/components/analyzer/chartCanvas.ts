import { analyzerBus, readBusMessage } from "../../state/chartSync";
import { chartTheme } from "../../state/themes";
import { clamp01, spectroColormap } from "./colormap";
import { formatTimeTick } from "./axisFormat";
import { drawNoteMarkers, noteGroups } from "./notePlugins";
import type { LaneSelection } from "../notes/lane";
import type { AnalyzerId } from "../../state/analyzer";
import type { ChartView, PlotBox } from "./chartGeometry";

/**
 * Drawing primitives shared by the plain-canvas heatmaps (`MatrixView` /
 * `SpectrogramTab`): the canvas frame, the offscreen heatmap image, the time axis,
 * the hover cross, the shared cursor mirror, the preview playhead, and the note overlay.
 * They keep the two heatmaps pixel-identical without duplicating the drawing code.
 */

/**
 * Stroke `path` twice: a background-coloured **halo** under the colour.
 *
 * A heatmap's background *is* the data, so its colour ranges over the whole ramp (near
 * black to near white). No single stroke colour contrasts with all of it, so every rule
 * and contour drawn over a heatmap is outlined in the heatmap's background colour: the
 * halo separates the line from whatever band it crosses, and the line itself is then read
 * against the halo. Flat-background charts (uPlot) need none of this.
 */
export function strokeOverRamp(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  width: number,
  dash: number[] = [],
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = chartTheme().spectroBackground;
  ctx.lineWidth = width + 2.5;
  ctx.stroke(path);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.stroke(path);
  ctx.restore();
}

/** Clear the canvas, scale it to the device pixel ratio, and paint the background. */
export function beginFrame(
  canvas: HTMLCanvasElement | undefined,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const ctx = canvas?.getContext("2d");
  if (!ctx || width <= 0 || height <= 0) return null;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = chartTheme().spectroBackground;
  ctx.fillRect(0, 0, width, height);
  return ctx;
}

/**
 * Build the offscreen `frames × bins` image (time ×, band ↑) for a heatmap: `cell`
 * returns the value at a column `x` and a bottom-up row (row 0 = lowest band), and
 * `lo`/`span` map it through the active colormap. Rebuilt on data/range change.
 */
export function buildHeatmapImage(
  frames: number,
  bins: number,
  lo: number,
  span: number,
  cell: (x: number, row: number) => number,
): HTMLCanvasElement | null {
  const off = document.createElement("canvas");
  // Time runs horizontally, bands vertically.
  off.width = frames;
  off.height = bins;
  const ctx = off.getContext("2d");
  if (!ctx) return null;
  const pixels = ctx.createImageData(frames, bins);
  for (let y = 0; y < bins; y++) {
    // Top row = highest band.
    const row = bins - 1 - y;
    for (let x = 0; x < frames; x++) {
      const [r, g, bl] = spectroColormap(clamp01((cell(x, row) - lo) / span));
      const offset = (y * frames + x) * 4;
      pixels.data[offset] = r;
      pixels.data[offset + 1] = g;
      pixels.data[offset + 2] = bl;
      pixels.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return off;
}

/** Draw a source sub-rectangle of the offscreen image into the plot box, unsmoothed. */
export function blitHeatmap(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  box: PlotBox,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sw, sh, box.x, box.y, box.width, box.height);
  ctx.imageSmoothingEnabled = true;
}

/** Time-axis labels across the plot bottom, aligned so the end stops stay inside. */
export function drawTimeAxis(ctx: CanvasRenderingContext2D, view: ChartView, box: PlotBox): void {
  const span = view.t1 - view.t0;
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = chartTheme().axis;
  ctx.textBaseline = "top";
  // Keep the edge labels inside the canvas: left/right align the end stops.
  for (const [frac, align] of [
    [0, "left"],
    [0.5, "center"],
    [1, "right"],
  ] as const) {
    const time = view.t0 + frac * span;
    ctx.textAlign = align;
    ctx.fillText(
      `${formatTimeTick(time, span)}s`,
      box.x + frac * box.width,
      box.y + box.height + 4,
    );
  }
  ctx.textAlign = "left";
}

/** A full-height vertical rule across the plot at canvas-x, haloed for a heatmap. */
function verticalRule(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  x: number,
  color: string,
  width: number,
  dash: number[] = [],
): void {
  const px = Math.round(x) + 0.5;
  const path = new Path2D();
  path.moveTo(px, box.y);
  path.lineTo(px, box.y + box.height);
  strokeOverRamp(ctx, path, color, width, dash);
}

/** The hover cross at the pointer's plot position, when the pointer is on the chart. */
export function drawHoverCross(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  point: { x: number; y: number } | null,
): void {
  if (!point) return;
  const px = Math.round(point.x) + 0.5;
  const py = Math.round(point.y) + 0.5;
  const path = new Path2D();
  path.moveTo(box.x, py);
  path.lineTo(box.x + box.width, py);
  path.moveTo(px, box.y);
  path.lineTo(px, box.y + box.height);
  strokeOverRamp(ctx, path, chartTheme().hover, 1);
}

/**
 * The mirrored cursor of whichever other time chart is hovered (M5): a dashed rule, the
 * same position on every time chart and on the Timeline. `readBusMessage` reads the whole
 * message so the caller's repaint effect keeps the position in its dependencies — see
 * `state/chartSync.ts`.
 */
export function drawMirrorCursor(
  ctx: CanvasRenderingContext2D,
  view: ChartView,
  box: PlotBox,
  id: string,
): void {
  const msg = readBusMessage(analyzerBus.data.cursorSync);
  if (!msg || msg.group !== "time" || msg.sourceId === id || msg.x == null) return;
  const span = view.t1 - view.t0;
  if (!(span > 0)) return;
  const x = box.x + ((msg.x - view.t0) / span) * box.width;
  if (x < box.x || x > box.x + box.width) return;
  verticalRule(ctx, box, x, chartTheme().mirror, 1, [4, 4]);
}

/**
 * The **preview playhead** (M14 follow-up): a solid rule at the source second the core is
 * auditioning, so a heatmap shows "playing now" exactly like the Timeline and the uPlot
 * charts do (`analyzer/syncPlugins.ts` → `playheadRule`). Reads the shared bus, so every
 * chart draws the same position.
 */
export function drawPlayhead(ctx: CanvasRenderingContext2D, view: ChartView, box: PlotBox): void {
  const secs = analyzerBus.data.playhead?.secs;
  if (secs == null) return;
  const span = Math.max(view.t1 - view.t0, 1e-9);
  const x = box.x + ((secs - view.t0) / span) * box.width;
  if (!Number.isFinite(x) || x < box.x || x > box.x + box.width) return;
  verticalRule(ctx, box, x, chartTheme().playhead, 1.5);
}

/** This chart's own notes, other charts' notes (muted), and the focused note (M14) —
 * plus the lane's live selection, if one is being dragged out. */
export function drawNoteOverlay(
  ctx: CanvasRenderingContext2D,
  view: ChartView,
  box: PlotBox,
  tool: AnalyzerId | string,
  selection: LaneSelection = null,
): void {
  const span = Math.max(view.t1 - view.t0, 1e-9);
  drawNoteMarkers(
    ctx,
    {
      xFor: (time) => box.x + ((time - view.t0) / span) * box.width,
      top: box.y,
      height: box.height,
      left: box.x,
      right: box.x + box.width,
    },
    noteGroups(tool),
    { selection },
  );
}
