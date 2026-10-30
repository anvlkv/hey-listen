import { chartTheme } from "../../state/themes";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { Span } from "../../state/compare/types";
import type { PlotBox } from "../analyzer/chartGeometry";

/**
 * The compare view's live marks on a **plain-canvas** chart (M25.A): the reference's
 * analysis window band, both playheads and B's read-only time cursor. They mirror
 * [`peerPlugins`](./peerPlugins.ts) — which does the same for the uPlot charts — so a
 * heatmap and an overlaid line chart describe the two projects identically.
 */

/** The reference's analysis window as a faint band with dashed edges. */
export function drawWindowBand(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  span: Span,
  band: Span | null,
): void {
  if (!band || !(span.end > span.start)) return;
  const x0 = box.x + ((band.start - span.start) / (span.end - span.start)) * box.width;
  const x1 = box.x + ((band.end - span.start) / (span.end - span.start)) * box.width;
  const left = Math.max(box.x, Math.min(x0, x1));
  const right = Math.min(box.x + box.width, Math.max(x0, x1));
  if (!(right > left)) return;
  ctx.save();
  ctx.fillStyle = chartTheme().select;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(left, box.y, right - left, box.height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = chartTheme().compareA;
  ctx.setLineDash([2, 4]);
  ctx.lineWidth = 1;
  for (const x of [left, right]) {
    const px = Math.round(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, box.y);
    ctx.lineTo(px, box.y + box.height);
    ctx.stroke();
  }
  ctx.restore();
}

/** Both transports and B's cursor on a time-axis canvas chart. */
export function drawLiveMarkers(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  span: Span,
  live: CompareLiveHandle | undefined,
  swapped: boolean,
): void {
  if (!live || !(span.end > span.start)) return;
  const a = swapped ? live.b() : live.a();
  const b = swapped ? live.a() : live.b();
  drawRule(ctx, box, span, a.playhead, chartTheme().playhead);
  drawRule(ctx, box, span, b.playhead, chartTheme().compareB, [5, 4]);
  drawRule(ctx, box, span, b.cursorTime, chartTheme().mirror, [4, 4]);
}

/** One full-height vertical rule at a source second. */
function drawRule(
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  span: Span,
  secs: number | null | undefined,
  color: string,
  dash: number[] = [],
): void {
  if (secs == null || !Number.isFinite(secs)) return;
  const x = box.x + ((secs - span.start) / (span.end - span.start)) * box.width;
  if (x < box.x || x > box.x + box.width) return;
  const px = Math.round(x) + 0.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(px, box.y);
  ctx.lineTo(px, box.y + box.height);
  ctx.stroke();
  ctx.restore();
}
