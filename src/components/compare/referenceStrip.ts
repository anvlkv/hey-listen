import { chartTheme } from "../../state/themes";
import type { Span } from "../../state/compare/types";
import { ANNOTATION_STRIP_H } from "../annotations/strip";

/**
 * The **reference-fragment strip** (D-15): the labelled lane in the bottom
 * `ANNOTATION_STRIP_H` of a compare chart whose x-axis is **time**, reusing the annotation
 * lane's geometry.
 *
 * The compare axis is relative (each side starts at 0), so the faint band says how wide the
 * reference's window is but not *when* it is. The strip answers that: the fragment bar spans
 * the band's remapped extent and the label names the reference's **absolute** source seconds.
 * It is orientation chrome — no pointer gesture, no data — so it stays a thin fill in the lane
 * rather than a second band.
 */

/** The uPlot surface the strip reads (a uPlot instance satisfies it). */
export interface StripSurface {
  ctx: CanvasRenderingContext2D;
  bbox: { left: number; top: number; width: number; height: number };
  /** uPlot's `valToPos(secs, "x", true)`: a display second → canvas pixels. */
  valToPos: (value: number, scale: string, canvasPx: boolean) => number;
}

/** The strip's label: the reference window in **absolute** seconds. */
export function referenceStripLabel(span: Span): string {
  return `ref ${span.start.toFixed(2)}–${span.end.toFixed(2)} s`;
}

/**
 * Draw the reference fragment in the lane. `band` is the reference window on the chart's
 * relative axis (the same span the faint band uses); `absolute` is that window's source
 * seconds, which only the label needs.
 */
export function drawReferenceStrip(
  surface: StripSurface,
  band: Span | null,
  absolute: Span | null,
): void {
  if (!band) return;
  const { ctx, bbox } = surface;
  const x0 = surface.valToPos(band.start, "x", true);
  const x1 = surface.valToPos(band.end, "x", true);
  if (!Number.isFinite(x0) || !Number.isFinite(x1) || x1 - x0 <= 0) return;

  const left = bbox.left;
  const right = bbox.left + bbox.width;
  const stripTop = bbox.top + bbox.height - ANNOTATION_STRIP_H;
  // Clamped like the annotation lane's handles, so the bar sits inside the lane at any zoom.
  const barLeft = Math.max(left, Math.round(x0));
  const barRight = Math.min(right, Math.round(x1));
  if (barRight <= barLeft) return;

  const theme = chartTheme();
  ctx.save();
  // Clip to the lane so a partly-visible fragment (and its label) never leaves the plot box.
  ctx.beginPath();
  ctx.rect(left, stripTop, right - left, ANNOTATION_STRIP_H);
  ctx.clip();

  ctx.fillStyle = theme.compareB;
  ctx.globalAlpha = 0.32;
  ctx.fillRect(barLeft, stripTop + 1, barRight - barLeft, ANNOTATION_STRIP_H - 2);
  ctx.globalAlpha = 1;
  // Edge ticks only at edges actually in view: a clamped edge is a clip, not an extent.
  ctx.strokeStyle = theme.compareB;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of [x0, x1]) {
    if (x < left || x > right) continue;
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, stripTop);
    ctx.lineTo(px, stripTop + ANNOTATION_STRIP_H);
  }
  ctx.stroke();

  if (absolute && Number.isFinite(absolute.start) && Number.isFinite(absolute.end)) {
    const label = referenceStripLabel(absolute);
    ctx.font = theme.font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = theme.compareB;
    const width = ctx.measureText(label).width;
    // Just inside the fragment's start, flipped back inside the plot when it would overflow.
    let textX = barLeft + 3;
    if (textX + width > right - 3) textX = Math.max(left + 3, right - 3 - width);
    ctx.fillText(label, textX, stripTop + ANNOTATION_STRIP_H / 2 + 0.5);
  }
  ctx.restore();
}
