import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { Annotation } from "../../bindings/Annotation";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { annotationHeading, annotationSpan } from "../../lib/annotation";
import { chartTheme } from "../../state/themes";
import { ANNOTATION_STRIP_H } from "../annotations/strip";
import {
  createLaneDrag,
  drawLane,
  type LaneController,
  type LaneGeom,
  type LaneSelection,
} from "../annotations/lane";
import type { AnalyzerId } from "../../state/analyzer";

/**
 * Annotation markers on the analyzer charts (M14): a chart draws **its own** annotations
 * (full-strength anchors), every **other** annotation slightly muted, and the **selected**
 * annotation as a full-height rule with a label. An annotation is drawn in the **lane** along the
 * bottom of the plot (`components/annotations/lane.ts`, which also owns the pointer gesture
 * — drag a handle to move / resize, drag empty space to select a span for a new annotation).
 * The frequency-axis `spectrum` draws none (a time marker has no meaning on a frequency
 * axis). Annotations arrive on the shared [`analyzerBus`](../../state/chartSync.ts) (`annotations`),
 * published by the annotations store, so cross-window and store changes redraw in step. A
 * range annotation shows a handle on each edge. See `docs/annotations.md`.
 */

/** The selected annotation's marker label font — larger than the axis font, so it reads. */
const NOTE_LABEL_FONT = "600 12px Inter, sans-serif";

/** Canvas geometry for the lane's markers. */
export type AnnotationGeom = LaneGeom;

/** The annotations a chart draws: its own, the others (muted), and the selected one. */
export interface AnnotationGroups {
  own: Annotation[];
  others: Annotation[];
  selected: Annotation | null;
  /** Whether the Annotations rail is open — closed draws the anchors dull (see [`drawAnnotationMarkers`]). */
  panelOpen: boolean;
}

/** Partition the bus annotations for a chart with `tool` (reads the bus reactively). */
export function annotationGroups(tool: AnalyzerId | string): AnnotationGroups {
  const message = analyzerBus.data.annotations;
  const all = message?.annotations ?? [];
  const selectedId = message?.selectedId ?? null;
  const selected = selectedId
    ? (all.find((annotation) => annotation.id === selectedId) ?? null)
    : null;
  const own: Annotation[] = [];
  const others: Annotation[] = [];
  for (const annotation of all) {
    if (annotation.id === selectedId) continue;
    (annotation.tool === tool ? own : others).push(annotation);
  }
  return { own, others, selected, panelOpen: message?.panelOpen ?? false };
}

/** Every annotation a chart's lane shows: its own, the others', and the selected one. */
export function laneAnnotations(tool: AnalyzerId | string): Annotation[] {
  const { own, others, selected } = annotationGroups(tool);
  return selected ? [...own, ...others, selected] : [...own, ...others];
}

/** The selected annotation's marker label: its values line, else its heading. */
export function annotationMarkerLabel(annotation: Annotation): string {
  return annotation.values?.text || annotationHeading(annotation.body, 32) || "Annotation";
}

const inRange = (x: number, geom: AnnotationGeom) =>
  Number.isFinite(x) && x >= geom.left && x <= geom.right;

/** The lane's top edge inside the plot area. */
const laneTopOf = (geom: AnnotationGeom) => geom.top + geom.height - ANNOTATION_STRIP_H;

/**
 * An annotation's grab handles in the lane: two caps joined by a span bar for a range, a
 * single tab for a point annotation. The geometry the pointer hit-test uses, so a click
 * always lands on a handle the user can see.
 */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  geom: AnnotationGeom,
  annotation: Annotation,
  color: string,
  cap: number,
) {
  const span = annotationSpan(annotation);
  const stripTop = laneTopOf(geom);
  const x0 = Math.round(geom.xFor(span.start));
  const x1 = Math.round(geom.xFor(span.end));
  const top = stripTop + 1;
  const height = ANNOTATION_STRIP_H - 2;
  ctx.fillStyle = color;
  if (span.end > span.start) {
    ctx.fillRect(x0, stripTop + 4, Math.max(1, x1 - x0), 3);
    ctx.fillRect(x0 - 3, top, 6, height);
    ctx.fillRect(x1 - 3, top, 6, height);
    return;
  }
  ctx.fillRect(x0 - 1, top, 2, height);
  ctx.fillRect(x0 - cap / 2, top, cap, 3);
}

/** An annotation's anchor in the lane (a shaded span for a range annotation). */
function tick(
  ctx: CanvasRenderingContext2D,
  geom: AnnotationGeom,
  annotation: Annotation,
  color: string,
  alpha: number,
) {
  const span = annotationSpan(annotation);
  if (span.end > span.start) {
    const x0 = geom.xFor(span.start);
    const x1 = geom.xFor(span.end);
    if (x1 > geom.left && x0 < geom.right) {
      ctx.globalAlpha = alpha * 0.16;
      ctx.fillStyle = color;
      ctx.fillRect(x0, geom.top, Math.max(1, x1 - x0), geom.height);
    }
  }
  const x = geom.xFor(span.start);
  if (!inRange(x, geom)) return;
  const stripTop = laneTopOf(geom);
  // A faint stem rising out of the lane, then the handle(s) inside it.
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, stripTop - 6);
  ctx.lineTo(Math.round(x) + 0.5, stripTop);
  ctx.stroke();
  ctx.globalAlpha = alpha;
  drawHandles(ctx, geom, annotation, color, 6);
}

/**
 * Draw the annotation lane and its markers onto a 2-D context. Shared by the uPlot plugin
 * and the canvas heatmaps (`MatrixView` / `SpectrogramTab`) so the lane looks (and
 * behaves) identical everywhere.
 */
export function drawAnnotationMarkers(
  ctx: CanvasRenderingContext2D,
  geom: AnnotationGeom,
  groups: AnnotationGroups,
  opts: { selection?: LaneSelection; hint?: string | null } = {},
) {
  const { own, others, selected } = groups;
  const theme = chartTheme();
  drawLane(ctx, geom, {
    background: theme.ruler,
    color: theme.annotation,
    hintColor: theme.axis,
    hint: opts.hint ?? null,
    selection: opts.selection ?? null,
  });
  if (own.length === 0 && others.length === 0 && !selected) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(geom.left, geom.top, Math.max(0, geom.right - geom.left), geom.height);
  ctx.clip();

  // A closed rail keeps the anchors (they still mark where the annotations are) but draws them
  // dull, so annotations recede once the user is no longer working with them.
  const quiet = groups.panelOpen ? 1 : 0.55;
  for (const annotation of others) tick(ctx, geom, annotation, theme.annotation, 0.28 * quiet);
  for (const annotation of own) tick(ctx, geom, annotation, theme.annotation, 0.7 * quiet);
  ctx.globalAlpha = 1;

  // The selected annotation: a full-height rule on each edge (a shaded span for a range),
  // its handles in the lane, and its label. Only while the rail is open — that is
  // what "selected" means to the user.
  if (selected && groups.panelOpen) {
    const span = annotationSpan(selected);
    const x0 = geom.xFor(span.start);
    const x1 = geom.xFor(span.end);
    if (selected.range && x1 > geom.left && x0 < geom.right) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = theme.annotation;
      ctx.fillRect(x0, geom.top, Math.max(1, x1 - x0), geom.height);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.annotation;
    ctx.lineWidth = span.end > span.start ? 1 : 1.5;
    for (const edge of span.end > span.start ? [x0, x1] : [x0]) {
      if (!inRange(edge, geom)) continue;
      const px = Math.round(edge) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, geom.top);
      ctx.lineTo(px, geom.top + geom.height);
      ctx.stroke();
    }
    drawHandles(ctx, geom, selected, theme.annotation, 8);
    if (inRange(x0, geom)) {
      // A label chip just above the lane, so it stays readable over a heatmap.
      const label = annotationMarkerLabel(selected);
      ctx.font = NOTE_LABEL_FONT;
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      const width = ctx.measureText(label).width;
      const px = Math.round(x0) + 0.5;
      let lx = px + 6;
      if (lx + width > geom.right) lx = Math.max(geom.left, px - 6 - width);
      const baseline = laneTopOf(geom) - 4;
      ctx.globalAlpha = 0.82;
      ctx.fillStyle = theme.background;
      ctx.fillRect(lx - 3, baseline - 15, width + 6, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.annotation;
      ctx.fillText(label, lx, baseline);
    }
  }
  ctx.restore();
}

/**
 * uPlot plugin: the lane's markers (own + muted others + the selected rule) on a chart,
 * with the lane gesture wired to the plot's overlay — drag a handle to move / resize a
 * annotation, drag empty lane space to select a span for a new one.
 */
export function annotationMarkers(tool: AnalyzerId): UplotPluginFactory<AnalyzerBus> {
  return () => {
    let groups: AnnotationGroups = { own: [], others: [], selected: null, panelOpen: false };
    let lane: LaneController | undefined;
    let dispose: (() => void) | undefined;
    const listeners: [string, EventListener][] = [];

    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            lane = createLaneDrag(() => ({
              annotations: () => laneAnnotations(tool),
              tool: () => tool,
              // **Plot-relative** coordinates: `u.over` *is* the plot area (uPlot positions
              // it at the plot's top-left), so the pointer and the mapper must both be
              // relative to it — `valToPos(..., true)` returns canvas pixels instead.
              timeAt: (time) => u.valToPos(time, "x"),
              timeFromX: (x) => u.posToVal(x, "x"),
            }));
            createEffect(() => {
              groups = annotationGroups(tool);
              // `u.redraw()` (not `redraw(false)`, which commits without drawing unless a
              // scale change is pending) — a plugin-driven repaint must always repaint.
              u.redraw();
            });
            // Repaint while a selection is being dragged out in the lane.
            createEffect(() => {
              lane?.selection();
              u.redraw();
            });
            return root;
          });

          const onDown = (event: PointerEvent) => {
            if (!u.over || event.button !== 0 || !lane) return;
            const rect = u.over.getBoundingClientRect();
            const localY = event.clientY - rect.top;
            // Only the bottom lane grabs, so plot drag/zoom keeps working above it.
            if (localY < u.bbox.height - ANNOTATION_STRIP_H) return;
            if (!lane.down(event.clientX - rect.left)) return;
            event.stopPropagation();
            event.preventDefault();
            u.over.setPointerCapture(event.pointerId);
          };

          const onMove = (event: PointerEvent) => {
            if (!u.over || !lane) return;
            const rect = u.over.getBoundingClientRect();
            lane.move(u.posToVal(event.clientX - rect.left, "x"));
          };

          const onUp = (event: PointerEvent) => {
            lane?.up();
            if (u.over?.hasPointerCapture(event.pointerId)) {
              u.over.releasePointerCapture(event.pointerId);
            }
          };

          for (const [type, handler] of [
            ["pointerdown", onDown],
            ["pointermove", onMove],
            ["pointerup", onUp],
            ["pointercancel", onUp],
          ] as [string, EventListener][]) {
            u.over.addEventListener(type, handler, { capture: true });
            listeners.push([type, handler]);
          }
        },
        draw: (u) => {
          if (!u.ctx) return;
          drawAnnotationMarkers(
            u.ctx,
            {
              xFor: (time) => u.valToPos(time, "x", true),
              top: u.bbox.top,
              height: u.bbox.height,
              left: u.bbox.left,
              right: u.bbox.left + u.bbox.width,
            },
            groups,
          );
        },
        destroy: (u) => {
          for (const [type, handler] of listeners) {
            u.over.removeEventListener(type, handler, { capture: true });
          }
          listeners.length = 0;
          dispose?.();
        },
      },
    };
  };
}
