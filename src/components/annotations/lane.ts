import { createSignal, type Accessor } from "solid-js";
import type { Annotation } from "../../bindings/Annotation";
import { analyzerById, isAnalyzerId, type AnalyzerId } from "../../state/analyzer";
import {
  annotationById,
  createAnnotation,
  dragAnnotationEndTo,
  dragAnnotationTo,
  refreshAnnotationValues,
  selectAnnotation,
  setSelectedAnnotation,
} from "../../state/annotations";
import { annotationLabel, annotationSpan, annotationTimeText } from "../../lib/annotation";
import { source } from "../../state/source";
import type { AnnotationEdge, RuleSpan } from "./rules";

/**
 * The **annotation lane** (M14): the thin strip along the bottom of the Timeline and of every
 * time chart, where annotations are created, moved and resized.
 *
 * One pointer state machine serves all three hosts (the Timeline canvas, the uPlot
 * charts, the canvas heatmaps), so the lane behaves identically everywhere:
 *
 * - press on an annotation's **handle** → drag it: a point annotation moves, a range resizes from
 *   whichever edge was grabbed (grabbing anywhere across a range takes its nearer edge);
 * - press on **empty lane space** and drag → a live **selection**; releasing it creates a
 *   **range** annotation over that span (a bare click does nothing, so the lane is safe to
 *   click through).
 *
 * Creating an annotation selects it and opens its editor, but **never moves the analysis
 * window** — an annotation is an annotation *on* the analysis, not a request to reframe it.
 * Grabbing an annotation's handle and clicking it behave the same way: a drag moves/resizes it
 * and a click just selects it. Only the row's **Analyze** button reframes (see
 * `state/annotations/select.ts`).
 */

/** Which edge of an annotation's span a lane handle moves (see `./rules.ts`). */
export type { AnnotationEdge } from "./rules";

/** A span being dragged out in the lane (source seconds), or `null`. */
export type LaneSelection = { start: number; end: number } | null;

/**
 * A handle drag in progress: the edge being moved, the span the drag began from (the
 * **ghost** edge) and the live span (the **moving** edge), all in source seconds.
 */
export interface LaneHandleDrag {
  id: string;
  edge: AnnotationEdge;
  from: RuleSpan;
  to: RuleSpan;
}

/** Canvas geometry for the lane: its bounds inside the drawing surface, plus a mapper. */
export interface LaneGeom {
  xFor: (timeSecs: number) => number;
  top: number;
  height: number;
  left: number;
  right: number;
}

/** How close (px) the pointer must be to an annotation handle to grab it. */
export const LANE_HIT_PX = 10;

/** The annotation handle nearest lane-local `x`, or `null` for empty lane space. */
export function annotationHandleAt(
  annotations: Annotation[],
  timeAt: (timeSecs: number) => number,
  x: number,
): { annotation: Annotation; edge: AnnotationEdge } | null {
  let best: { annotation: Annotation; edge: AnnotationEdge } | null = null;
  let bestDistance = LANE_HIT_PX;
  for (const annotation of annotations) {
    const span = annotationSpan(annotation);
    if (span.end > span.start) {
      // A range is grabbable anywhere across its span; the nearer edge wins.
      const x0 = timeAt(span.start);
      const x1 = timeAt(span.end);
      const edge: AnnotationEdge = Math.abs(x - x0) <= Math.abs(x - x1) ? "start" : "end";
      const inside = x >= Math.min(x0, x1) && x <= Math.max(x0, x1);
      const distance = inside ? 0 : Math.min(Math.abs(x - x0), Math.abs(x - x1));
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { annotation, edge };
      }
      continue;
    }
    const distance = Math.abs(timeAt(span.start) - x);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = { annotation, edge: "start" };
    }
  }
  return best;
}

/** The span a lane drag from `anchor` to `head` covers, ordered and clamped. */
export function laneSelection(
  anchor: number,
  head: number,
  duration: number,
): {
  start: number;
  end: number;
} {
  const lo = Math.max(0, Math.min(anchor, head));
  const hi = Math.max(anchor, head);
  return { start: lo, end: duration > 0 ? Math.min(hi, duration) : hi };
}

/** What the lane's pointer handlers need to know about their host. */
export interface LaneHost {
  /** The annotations the lane shows (its own, other charts', the selected one). */
  annotations: () => Annotation[];
  /** The chart an annotation created in this lane belongs to (`null` = a Timeline annotation). */
  tool: () => AnalyzerId | null;
  /** A time → lane-local x mapper, for hit-testing handles (the same one it draws with). */
  timeAt: (timeSecs: number) => number;
  /** A lane-local x → time mapper, for a new selection. */
  timeFromX: (x: number) => number;
}

/** The lane's drag state, driven by whichever host owns the pointer. */
export interface LaneController {
  /** Begin a drag at lane-local `x`. Returns `true` when the lane took the gesture. */
  down: (x: number) => boolean;
  /** Report a move (a source time), while a drag is in progress. */
  move: (timeSecs: number) => void;
  /** Finish the drag: commit a resize, or create the selected annotation. */
  up: () => void;
  /** The span being dragged out, for the host to draw (`null` when there is none). */
  selection: Accessor<LaneSelection>;
  /** The handle being dragged, with its original span, for the host to draw the ghost. */
  drag: Accessor<LaneHandleDrag | null>;
}

/** Create the lane's drag state for one host. */
export function createLaneDrag(host: () => LaneHost): LaneController {
  const [selection, setSelection] = createSignal<LaneSelection>(null);
  const [handleDrag, setHandleDrag] = createSignal<LaneHandleDrag | null>(null);
  let drag:
    | { kind: "handle"; id: string; edge: AnnotationEdge }
    | { kind: "select"; anchor: number }
    | null = null;
  let moved = false;

  const down = (x: number): boolean => {
    const { annotations, timeAt, timeFromX } = host();
    moved = false;
    const hit = annotationHandleAt(annotations(), timeAt, x);
    if (hit) {
      drag = { kind: "handle", id: hit.annotation.id, edge: hit.edge };
      const span = annotationSpan(hit.annotation);
      setHandleDrag({ id: hit.annotation.id, edge: hit.edge, from: span, to: span });
      return true;
    }
    const anchor = timeFromX(x);
    drag = { kind: "select", anchor };
    setSelection({ start: anchor, end: anchor });
    return true;
  };

  const move = (timeSecs: number) => {
    if (!drag) return;
    moved = true;
    if (drag.kind === "handle") {
      // The start edge moves a point annotation or resizes a range from the left; the end
      // edge resizes it.
      if (drag.edge === "end") dragAnnotationEndTo(drag.id, timeSecs);
      else dragAnnotationTo(drag.id, timeSecs);
      // Read the clamped span back, so the drawn moving edge is exactly the stored one.
      const live = annotationById(drag.id);
      if (live) setHandleDrag((prev) => (prev ? { ...prev, to: annotationSpan(live) } : prev));
      return;
    }
    setSelection(laneSelection(drag.anchor, timeSecs, source()?.duration ?? 0));
  };

  const up = () => {
    const active = drag;
    const sel = selection();
    drag = null;
    setSelection(null);
    setHandleDrag(null);
    if (!active) return;
    if (active.kind === "handle") {
      if (moved) {
        // The annotation moved: re-snapshot its values and keep it selected.
        refreshAnnotationValues(active.id);
        setSelectedAnnotation(active.id);
      } else {
        selectAnnotation(active.id);
      }
      return;
    }
    if (!moved || !sel) return;
    const isRange = sel.end > sel.start;
    createAnnotation({
      timeSecs: sel.start,
      range: isRange ? { startSecs: sel.start, endSecs: sel.end } : null,
      tool: host().tool(),
    });
  };

  return { down, move, up, selection, drag: handleDrag };
}

/**
 * Draw the lane: its background, a hint while it is empty, and the live selection.
 * The hosts draw their annotations on top (see `analyzer/annotationPlugins.ts`).
 */
export function drawLane(
  ctx: CanvasRenderingContext2D,
  geom: LaneGeom,
  opts: {
    /** The lane's background fill. */
    background: string;
    /** The annotation colour: the selection fill / edge rule. */
    color: string;
    /** The hint text colour (muted). */
    hintColor: string;
    hint: string | null;
    /** Left edge for the hint chip (right of the channel rail), so it never sits under it. */
    hintLeft?: number;
    selection: LaneSelection;
  },
) {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = opts.background;
  ctx.fillRect(geom.left, geom.top, Math.max(0, geom.right - geom.left), geom.height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = opts.color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(geom.left, geom.top + 0.5);
  ctx.lineTo(geom.right, geom.top + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (opts.selection) {
    const [x0, x1] = [geom.xFor(opts.selection.start), geom.xFor(opts.selection.end)];
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = opts.color;
    ctx.fillRect(Math.min(x0, x1), geom.top + 1, Math.max(1, Math.abs(x1 - x0)), geom.height - 2);
    ctx.globalAlpha = 1;
  } else if (opts.hint) {
    drawHintChip(ctx, opts.hint, opts.hintLeft ?? geom.left + 8, geom, opts);
  }
  ctx.restore();
}

/**
 * The empty-lane hint: text on a small padded, rounded chip, so it reads over whatever the
 * lane's background is and never looks like a mark.
 */
function drawHintChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  left: number,
  geom: LaneGeom,
  opts: { color: string; hintColor: string },
): void {
  ctx.font = "11px Inter, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const padX = 6;
  const chipH = Math.max(8, Math.min(16, geom.height - 2));
  const room = Math.max(0, geom.right - left);
  const width = Math.min(ctx.measureText(text).width + padX * 2, room);
  if (width <= 0) return;
  const top = geom.top + (geom.height - chipH) / 2;
  const radius = chipH / 2;

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = opts.color;
  ctx.beginPath();
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + width, top, left + width, top + chipH, radius);
  ctx.arcTo(left + width, top + chipH, left, top + chipH, radius);
  ctx.arcTo(left, top + chipH, left, top, radius);
  ctx.arcTo(left, top, left + width, top, radius);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = opts.hintColor;
  ctx.globalAlpha = 0.9;
  ctx.fillText(text, left + padX, geom.top + geom.height / 2);
  ctx.globalAlpha = 1;
}

/**
 * The annotation's hover hint text (title · tool · time · values line, plus what the pointer
 * can do with it — the lane's handles are small, so the hint teaches them).
 */
export function annotationHintText(annotation: Annotation): string {
  const tool =
    annotation.tool && isAnalyzerId(annotation.tool)
      ? analyzerById(annotation.tool).title
      : "Timeline";
  const values = annotation.values ? ` · ${annotation.values.text}` : "";
  const action = annotation.range ? "drag an edge to resize" : "drag to move";
  return `${annotationLabel(annotation)} · ${tool} · ${annotationTimeText(annotation)}${values} — ${action}`;
}
