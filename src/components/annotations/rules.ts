/**
 * Annotation **vertical rules** (M23): the full-height edges an annotation draws across the
 * waveform or chart, plus the small label / `start → end (Δ)` chip above the lane.
 *
 * The geometry is pure ([`annotationRules`], [`handleDragRules`]) so it can be unit-tested,
 * and the two painters below are the single implementation both the Timeline
 * (`timeline/draw.ts`) and the analyzer charts (`analyzer/annotationPlugins.ts`) use — the
 * colour is always `chartTheme().annotation`, so the two surfaces agree.
 *
 * A **point** annotation has one edge; a **range** has two. A handle drag adds the edge's
 * original position as a dashed **ghost** next to the moving one.
 * See `docs/annotations.md` → Surfacing and `docs/roadmap.md` → M23 → "Annotation vertical rules".
 */

/** Which edge of an annotation's span a handle moves. */
export type AnnotationEdge = "start" | "end";

/** A span in source seconds (a point annotation has `start === end`). */
export interface RuleSpan {
  start: number;
  end: number;
}

/** One vertical rule: an edge of an annotation's span, placed at a canvas x. */
export interface AnnotationRule {
  edge: AnnotationEdge;
  /** The edge's time, in source seconds. */
  timeSecs: number;
  /** The edge's canvas x. */
  x: number;
  /** True for the fading original edge of a handle drag. */
  ghost: boolean;
}

/** The marker label font: larger than the axis font, so it reads over a waveform. */
export const ANNOTATION_LABEL_FONT = "600 12px Inter, sans-serif";

/** How tall a label chip is, in CSS pixels. */
const CHIP_H = 16;

/**
 * The rules an annotation's span draws: one for a point, two (start then end) for a
 * range. `ghost` marks the fading original edge of a handle drag.
 */
export function annotationRules(
  span: RuleSpan,
  xFor: (timeSecs: number) => number,
  ghost = false,
): AnnotationRule[] {
  const edges: [AnnotationEdge, number][] =
    span.end > span.start
      ? [
          ["start", span.start],
          ["end", span.end],
        ]
      : [["start", span.start]];
  return edges.map(([edge, timeSecs]) => ({ edge, timeSecs, x: xFor(timeSecs), ghost }));
}

/**
 * The rules a handle drag draws: the **moving** edge at its live position, plus the
 * **original** edge of the dragged handle as a ghost (so the change is visible).
 */
export function handleDragRules(
  from: RuleSpan,
  to: RuleSpan,
  edge: AnnotationEdge,
  xFor: (timeSecs: number) => number,
): AnnotationRule[] {
  const origin = edge === "end" ? from.end : from.start;
  const moving = edge === "end" ? to.end : to.start;
  return [
    { edge, timeSecs: origin, x: xFor(origin), ghost: true },
    { edge, timeSecs: moving, x: xFor(moving), ghost: false },
  ];
}

/** How a rule stack is painted between two canvas y coordinates. */
export interface RuleStyle {
  top: number;
  bottom: number;
  color: string;
  /** Width of a solid rule (a ghost is always 1 px, dashed). */
  width?: number;
}

/** Draw a rule stack full-height; a ghost rule is dashed and faint. */
export function drawAnnotationRules(
  ctx: CanvasRenderingContext2D,
  rules: AnnotationRule[],
  style: RuleStyle,
): void {
  ctx.save();
  ctx.strokeStyle = style.color;
  for (const rule of rules) {
    const x = Math.round(rule.x) + 0.5;
    ctx.globalAlpha = rule.ghost ? 0.35 : 1;
    ctx.lineWidth = rule.ghost ? 1 : (style.width ?? 1.5);
    ctx.setLineDash(rule.ghost ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(x, style.top);
    ctx.lineTo(x, style.bottom);
    ctx.stroke();
  }
  ctx.restore();
}

/** Where and how a chip is drawn: anchored to a rule, kept inside the plot. */
export interface ChipStyle {
  /** Text colour. */
  color: string;
  /** Background fill behind the text. */
  background: string;
  /** Keep the chip between these canvas x bounds. */
  left: number;
  right: number;
  /** Canvas y the text sits on (the chip is drawn just above it). */
  baseline: number;
  /** Text font (defaults to the lane's). */
  font?: string;
}

/** Draw a label / readout chip beside `anchorX`, clamped inside `[left, right]`. */
export function drawAnnotationChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  style: ChipStyle,
): void {
  ctx.save();
  ctx.font = style.font ?? "11px Inter, sans-serif";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  const width = ctx.measureText(text).width;
  const anchor = Math.round(anchorX) + 0.5;
  let lx = anchor + 6;
  if (lx + width > style.right) lx = Math.max(style.left, anchor - 6 - width);
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = style.background;
  ctx.fillRect(lx - 3, style.baseline - CHIP_H + 1, width + 6, CHIP_H);
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.color;
  ctx.fillText(text, lx, style.baseline);
  ctx.restore();
}
