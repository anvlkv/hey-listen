import { annotationMarkerLabel, annotationSpan } from "../../lib/annotation";
import { annotationsSorted, selectedAnnotationId } from "../../state/annotations";
import { annotationsPanelOpen } from "../../state/settings";
import { chartTheme } from "../../state/themes";
import { formatTime } from "./format";
import { ANNOTATION_STRIP_H } from "../annotations/strip";
import { drawLane, type LaneHandleDrag, type LaneSelection } from "../annotations/lane";
import {
  ANNOTATION_LABEL_FONT,
  annotationRules,
  drawAnnotationChip,
  drawAnnotationRules,
  handleDragRules,
} from "../annotations/rules";

/**
 * The Timeline's annotation **lane** (M14) and **vertical rules** (M23): the strip along the
 * bottom of the waveform where annotations are created, moved and resized, plus the
 * full-height rules an annotation draws across the waveform.
 *
 * - A **promoted** annotation (selected, hovered, or being dragged) draws a rule on each
 *   edge (one for a point), a tinted span for a range, its handles in the lane and a label
 *   chip; every other annotation keeps the faint tint and a short stem so the waveform
 *   stays readable.
 * - A **dragged handle** draws the moving edge and the edge it started from as a ghost.
 * - A **span dragged out** for a new annotation draws a translucent band, both edge rules
 *   and the live `start → end (Δ)` chip; the lane keeps its own selection fill.
 *
 * The geometry and the painters live in `components/annotations/rules.ts`, shared with the
 * analyzer charts. A **closed rail** draws the anchors dull (and never promotes one). The
 * rules are drawn before the window handles and the playhead, so those stay on top. See
 * `docs/annotations.md` → Surfacing.
 */
export interface TimelineAnnotationLayer {
  waveTop: number;
  waveH: number;
  width: number;
  t2x: (timeSecs: number) => number;
  /** Whether a source is open (the empty lane's hint only shows then). */
  hasSource: boolean;
  /** The span being dragged out for a new annotation. */
  selection: LaneSelection;
  /** The handle being dragged, with the span it started from. */
  drag: LaneHandleDrag | null;
  /** The annotation the pointer is over in the lane. */
  hovered: string | null;
}

/** Paint the lane, its anchors, the promoted annotation's rules and any live drag. */
export function drawTimelineAnnotations(
  ctx: CanvasRenderingContext2D,
  layer: TimelineAnnotationLayer,
): void {
  const { waveTop, waveH, width, t2x } = layer;
  const list = annotationsSorted();
  const theme = chartTheme();
  const stripTop = waveTop + waveH - ANNOTATION_STRIP_H;
  const geom = { xFor: t2x, top: stripTop, height: ANNOTATION_STRIP_H, left: 0, right: width };
  drawLane(ctx, geom, {
    background: theme.ruler,
    color: theme.annotation,
    hintColor: theme.axis,
    hint: layer.hasSource && list.length === 0 ? "Drag to add an annotation" : null,
    selection: layer.selection,
  });
  if (list.length === 0 && !layer.selection) return;

  // The span being dragged out for a new annotation: a band, both edge rules and the chip.
  if (layer.selection) drawSpanOverlay(ctx, layer, stripTop);

  const selectedId = selectedAnnotationId();
  // Promoted = the one the user is working with: rules, a label, a stronger tint.
  const promoted = (id: string) =>
    id === selectedId || id === layer.hovered || layer.drag?.id === id;
  // A closed rail keeps the pins but quiets them (see `analyzer/annotationPlugins.ts`).
  const quiet = annotationsPanelOpen() ? 1 : 0.55;
  // The quiet anchors go first, so a promoted annotation's rules and label always sit on top.
  const ordered = [...list].sort((a, b) => Number(promoted(a.id)) - Number(promoted(b.id)));

  for (const annotation of ordered) {
    const span = annotationSpan(annotation);
    const rules = annotationRules(span, t2x);
    if (rules.every((rule) => rule.x < -14 || rule.x > width + 14)) continue;
    const isRange = span.end > span.start;
    const dragging = layer.drag?.id === annotation.id ? layer.drag : null;
    const active = promoted(annotation.id);

    if (isRange) {
      ctx.globalAlpha = active ? 0.22 : 0.12 * quiet;
      ctx.fillStyle = theme.annotation;
      ctx.fillRect(rules[0].x, waveTop, Math.max(1, rules[1].x - rules[0].x), waveH);
      ctx.globalAlpha = 1;
    }

    if (dragging) {
      // The moving edge, full height, with the edge it started from as a dashed ghost.
      const live = handleDragRules(dragging.from, dragging.to, dragging.edge, t2x);
      drawAnnotationRules(ctx, live, {
        top: waveTop,
        bottom: stripTop,
        color: theme.annotation,
        width: 1.5,
      });
      drawRuleChip(ctx, spanChip(span), live[1].x, stripTop, width);
    } else if (active) {
      drawAnnotationRules(ctx, rules, {
        top: waveTop,
        bottom: stripTop,
        color: theme.annotation,
        width: 1.5,
      });
      drawRuleChip(ctx, annotationMarkerLabel(annotation), rules[0].x, stripTop, width);
    } else {
      // A faint short stem up out of the lane, so the anchor is still readable.
      ctx.globalAlpha = 0.7 * quiet;
      ctx.strokeStyle = theme.annotation;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(rules[0].x) + 0.5, stripTop - 7);
      ctx.lineTo(Math.round(rules[0].x) + 0.5, stripTop + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // The lane handles: a span bar with a cap per edge for a range, one tab for a point.
    const p0 = Math.round(rules[0].x);
    ctx.globalAlpha = active ? 1 : 0.85 * quiet;
    ctx.fillStyle = theme.annotation;
    if (isRange) {
      const p1 = Math.round(rules[1].x);
      ctx.fillRect(p0, stripTop + 4, Math.max(1, p1 - p0), 3);
      ctx.fillRect(p0 - 3, stripTop + 1, 6, ANNOTATION_STRIP_H - 2);
      ctx.fillRect(p1 - 3, stripTop + 1, 6, ANNOTATION_STRIP_H - 2);
    } else {
      const cap = active ? 8 : 6;
      ctx.fillRect(p0 - 1, stripTop + 1, 2, ANNOTATION_STRIP_H - 2);
      ctx.fillRect(p0 - cap / 2, stripTop + 1, cap, 3);
    }
    ctx.globalAlpha = 1;
  }
}

/** A live span dragged out in the lane: a translucent band, both edge rules, and the chip. */
function drawSpanOverlay(
  ctx: CanvasRenderingContext2D,
  layer: TimelineAnnotationLayer,
  stripTop: number,
): void {
  const selection = layer.selection;
  if (!selection) return;
  const theme = chartTheme();
  const rules = annotationRules(selection, layer.t2x);
  const left = Math.min(...rules.map((rule) => rule.x));
  const right = Math.max(...rules.map((rule) => rule.x));
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = theme.annotation;
  ctx.fillRect(left, layer.waveTop, Math.max(1, right - left), stripTop - layer.waveTop);
  ctx.globalAlpha = 1;
  drawAnnotationRules(ctx, rules, {
    top: layer.waveTop,
    bottom: stripTop,
    color: theme.annotation,
    width: 1.5,
  });
  drawRuleChip(ctx, spanChip(selection), right, stripTop, layer.width);
}

/** The annotation label chip just above the lane, anchored to a rule. */
function drawRuleChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  stripTop: number,
  width: number,
): void {
  const theme = chartTheme();
  drawAnnotationChip(ctx, text, anchorX, {
    color: theme.annotation,
    background: theme.background,
    left: 0,
    right: width,
    baseline: stripTop - 4,
    font: ANNOTATION_LABEL_FONT,
  });
}

/** The live `start → end (Δ)` readout while a span or an edge is dragged. */
function spanChip(span: { start: number; end: number }): string {
  const range = `${formatTime(span.start)} → ${formatTime(span.end)}`;
  return span.end > span.start ? `${range} (Δ ${formatTime(span.end - span.start)})` : range;
}
