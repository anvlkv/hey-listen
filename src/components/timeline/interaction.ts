import { batch, createSignal, onCleanup, type Accessor } from "solid-js";
import { seek } from "../../audio/preview";
import { stopFollowing } from "../../state/capture";
import { annotationsSorted } from "../../state/annotations";
import { createWheelGesture } from "../../lib/wheelGesture";
import {
  createLaneDrag,
  annotationHandleAt,
  annotationHintText,
  type LaneHandleDrag,
  type LaneSelection,
} from "../annotations/lane";
import { source } from "../../state/source";
import {
  reframeWindow,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "../../state/timeline";
import { HANDLE_HIT, MOVE_HIT, PREVIEW_THROTTLE, RULER_H } from "./constants";
import { formatTime } from "./format";
import { ANNOTATION_STRIP_H } from "../annotations/strip";

/**
 * Pointer interaction for the Timeline canvas: drag the start/end handles (with an edge
 * preview), drag the move bar to slide the window, **select** a new window with a plain
 * left drag, **pan** with the middle button, drag an annotation handle / draw an annotation
 * selection in the bottom lane, wheel pan/zoom, and the toolbar zoom actions. The
 * component-local capabilities arrive in [`TimelineInteractionDeps`]; the shared store
 * reads/writes are imported directly. See `docs/source-model.md` and `docs/roadmap.md` →
 * M23 → "Window readout, pan and select" and "Wheel and trackpad stability".
 */
type DragKind = "start" | "end" | "move" | "pan" | "select" | "seek";

export interface TimelineInteractionDeps {
  canvas: () => HTMLCanvasElement;
  active: () => boolean;
  duration: () => number;
  t2x: (t: number) => number;
  x2t: (x: number) => number;
  span: () => number;
  plotW: () => number;
  applyView: (a: number, b: number) => void;
  setAnnotationHint: (hint: { x: number; y: number; text: string } | null) => void;
  previewEdge: (kind: "start" | "end") => void;
  endPreview: () => void;
}

export interface TimelineInteraction {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  /** Pointer left the canvas: drop the lane hint and the promoted annotation. */
  onPointerLeave: () => void;
  onWheel: (e: WheelEvent) => void;
  zoomBy: (factor: number) => void;
  zoomToWindow: () => void;
  fitAll: () => void;
  /** The span being dragged out in the annotation lane, for the canvas to draw. */
  selection: Accessor<LaneSelection>;
  /** The annotation handle being dragged, for the canvas to draw its ghost edge. */
  laneDrag: Accessor<LaneHandleDrag | null>;
  /** The annotation the pointer is over in the lane (drawn promoted). */
  laneHover: Accessor<string | null>;
}

export function createTimelineInteraction(deps: TimelineInteractionDeps): TimelineInteraction {
  let drag: {
    kind: DragKind;
    pointerX: number;
    origViewStart: number;
    origViewEnd: number;
    origWindowStart: number;
    origWindowEnd: number;
  } | null = null;
  /** Whether the annotation lane owns the current gesture (a handle drag or a selection). */
  let laneActive = false;
  let lastPreview = 0;
  /** The annotation under the pointer in the lane: drawn with full-height rules + label. */
  const [laneHover, setLaneHover] = createSignal<string | null>(null);

  /** The Timeline's lane holds **Timeline annotations** (no chart). */
  const lane = createLaneDrag(() => ({
    annotations: () => annotationsSorted(),
    tool: () => null,
    timeAt: deps.t2x,
    timeFromX: (x) => deps.x2t(x),
  }));

  function pointerX(e: { clientX: number }): number {
    const rect = deps.canvas().getBoundingClientRect();
    return e.clientX - rect.left;
  }

  function pointerY(e: { clientY: number }): number {
    const rect = deps.canvas().getBoundingClientRect();
    return e.clientY - rect.top;
  }

  /** The top of the bottom annotation lane (where annotations are created, grabbed and resized). */
  function laneTop(): number {
    const rect = deps.canvas().getBoundingClientRect();
    return rect.height - ANNOTATION_STRIP_H;
  }

  function minWindow(): number {
    const s = source();
    return Math.max(1e-3, s ? 4 / s.sampleRate : 1e-3);
  }

  function clampTime(t: number): number {
    return Math.max(0, Math.min(deps.duration(), t));
  }

  function beginDrag(kind: DragKind, x: number, pointerId: number) {
    // A window gesture takes over: an annotation is no longer hovered.
    setLaneHover(null);
    drag = {
      kind,
      pointerX: x,
      origViewStart: viewStart(),
      origViewEnd: viewEnd(),
      origWindowStart: windowStart(),
      origWindowEnd: windowEnd(),
    };
    deps.canvas().setPointerCapture(pointerId);
  }

  function onPointerDown(e: PointerEvent) {
    if (!deps.active() || !source()) return;
    stopFollowing();
    const canvas = deps.canvas();
    const x = pointerX(e);
    const y = pointerY(e);

    // Middle-button drag pans the view; the primary button selects a window.
    if (e.button === 1) {
      e.preventDefault(); // stop the WebView's middle-click autoscroll
      beginDrag("pan", x, e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    // The ruler (top strip) seeks the transport playhead.
    if (y < RULER_H) {
      beginDrag("seek", x, e.pointerId);
      seek(clampTime(deps.x2t(x)));
      return;
    }

    // The annotation lane owns the bottom strip: grab a handle to move / resize an annotation, or
    // drag empty space to select a span for a new one.
    if (y >= laneTop() && lane.down(x)) {
      laneActive = true;
      setLaneHover(null);
      deps.setAnnotationHint(null);
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const ws = deps.t2x(windowStart());
    const we = deps.t2x(windowEnd());

    // Edge handles win at their x positions; the top bar covers the interior; the rest of
    // the waveform body (below the move bar, above the annotation lane) selects a window.
    let kind: DragKind | null = null;
    if (Math.abs(x - ws) <= HANDLE_HIT) kind = "start";
    else if (Math.abs(x - we) <= HANDLE_HIT) kind = "end";
    else if (x > ws && x < we && y >= RULER_H && y <= RULER_H + MOVE_HIT) kind = "move";
    else if (y > RULER_H + MOVE_HIT && y < laneTop()) kind = "select";
    if (!kind) return;

    beginDrag(kind, x, e.pointerId);

    if (kind === "select") {
      // A text-like selection starts collapsed at the pointer.
      const anchor = clampTime(deps.x2t(x));
      reframeWindow({ start: anchor, end: anchor });
    } else if (kind === "start" || kind === "end") {
      lastPreview = 0;
      deps.previewEdge(kind);
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (laneActive) {
      lane.move(deps.x2t(pointerX(e)));
      return;
    }
    if (!drag) {
      const x = pointerX(e);
      const y = pointerY(e);
      const hovered = y >= laneTop() ? annotationHandleAt(annotationsSorted(), deps.t2x, x) : null;
      deps.setAnnotationHint(
        hovered ? { x, y, text: annotationHintText(hovered.annotation) } : null,
      );
      setLaneHover(hovered?.annotation.id ?? null);
      return;
    }
    const x = pointerX(e);

    if (drag.kind === "seek") {
      seek(clampTime(deps.x2t(x)));
      return;
    }

    if (drag.kind === "pan") {
      const dt = ((drag.pointerX - x) / deps.plotW()) * deps.span();
      deps.applyView(drag.origViewStart + dt, drag.origViewEnd + dt);
      return;
    }

    const s = source();
    if (!s) return;

    if (drag.kind === "select") {
      // Text-like selection: the window spans the anchor (where the drag began) to the
      // pointer, in either direction, never shorter than the analysis minimum.
      const anchor = clampTime(deps.x2t(drag.pointerX));
      const t = clampTime(deps.x2t(x));
      const gap = minWindow();
      let lo = Math.min(anchor, t);
      let hi = Math.max(anchor, t);
      if (hi - lo < gap) {
        if (t >= anchor) hi = Math.min(deps.duration(), lo + gap);
        else lo = Math.max(0, hi - gap);
      }
      reframeWindow({ start: lo, end: hi });
      deps.setAnnotationHint({
        x,
        y: pointerY(e),
        text: `${formatTime(lo)} → ${formatTime(hi)}`,
      });
      return;
    }

    if (drag.kind === "move") {
      // Slide the whole window by the pointer delta, preserving its width and
      // keeping it inside [0, duration]. The viewport is left untouched.
      //
      // Both ends are written in one transaction: unbatched, each write would run every
      // window-dependent effect (the Timeline repaint, the analysis debounce, the chart
      // re-fit, the history snapshot, the cross-window push) on its own, doubling the
      // cost of a gesture that fires at pointer rate.
      const dur = deps.duration();
      const wLen = drag.origWindowEnd - drag.origWindowStart;
      const dt = deps.x2t(x) - deps.x2t(drag.pointerX);
      const start = Math.max(0, Math.min(dur - wLen, drag.origWindowStart + dt));
      batch(() => {
        setWindowStart(start);
        setWindowEnd(start + wLen);
      });
      return;
    }

    const t = Math.max(0, Math.min(deps.duration(), deps.x2t(x)));
    const gap = minWindow();
    if (drag.kind === "start") {
      setWindowStart(Math.max(0, Math.min(t, windowEnd() - gap)));
    } else {
      setWindowEnd(Math.min(deps.duration(), Math.max(t, windowStart() + gap)));
    }

    // Audition near the handle as it moves (throttled to avoid restart thrash).
    const now = performance.now();
    if (now - lastPreview > PREVIEW_THROTTLE) {
      lastPreview = now;
      deps.previewEdge(drag.kind);
    }
  }

  /** Not over the canvas any more: no hovered annotation, no hint. */
  function onPointerLeave() {
    deps.setAnnotationHint(null);
    setLaneHover(null);
  }

  function onPointerUp(e: PointerEvent) {
    const canvas = deps.canvas();
    if (laneActive) {
      laneActive = false;
      lane.up();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    if (!drag) return;
    const { kind, origWindowStart, origWindowEnd } = drag;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    // A selection and an edge drag both commit and reframe; move/pan do not (a playing
    // window preview follows the move via `audio/preview.ts`).
    if (kind !== "select" && kind !== "start" && kind !== "end") return;
    if (kind === "select") {
      deps.setAnnotationHint(null);
      // A plain click collapses the window to a point; treat it as a no-op.
      if (windowEnd() - windowStart() < minWindow()) {
        reframeWindow({ start: origWindowStart, end: origWindowEnd });
        return;
      }
      reframeWindow({ start: windowStart(), end: windowEnd(), frame: true });
      return;
    }
    deps.endPreview();
    reframeWindow({ start: windowStart(), end: windowEnd(), frame: true });
  }

  /** `Escape` during a selection drag puts the window back where it was. */
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || drag?.kind !== "select") return;
    e.preventDefault();
    const { origWindowStart, origWindowEnd } = drag;
    drag = null;
    reframeWindow({ start: origWindowStart, end: origWindowEnd });
    deps.setAnnotationHint(null);
  }

  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  /**
   * Plain wheel/trackpad scroll **pans** the time axis; `Ctrl`/`⌘` + wheel (a pinch)
   * **zooms** around the pointer. There is no vertical waveform zoom.
   */
  const wheel = createWheelGesture({
    enabled: () => source() != null,
    apply: (gesture) => {
      stopFollowing();
      if (gesture.kind === "zoom") {
        const t = deps.x2t(gesture.clientX - deps.canvas().getBoundingClientRect().left);
        deps.applyView(
          t + (viewStart() - t) * gesture.factor,
          t + (viewEnd() - t) * gesture.factor,
        );
        return;
      }
      // Pan time from the dominant delta: scrolling down or right advances the view.
      const delta = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? gesture.dx : gesture.dy;
      const dt = (delta / deps.plotW()) * deps.span();
      deps.applyView(viewStart() + dt, viewEnd() + dt);
    },
  });
  onCleanup(wheel.dispose);

  function zoomBy(factor: number) {
    stopFollowing();
    const center = (viewStart() + viewEnd()) / 2;
    deps.applyView(
      center + (viewStart() - center) * factor,
      center + (viewEnd() - center) * factor,
    );
  }

  function zoomToWindow() {
    stopFollowing();
    const wDur = windowEnd() - windowStart();
    const pad = Math.max(wDur * 0.05, 1e-3);
    deps.applyView(Math.max(0, windowStart() - pad), Math.min(deps.duration(), windowEnd() + pad));
  }

  function fitAll() {
    stopFollowing();
    deps.applyView(0, deps.duration());
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onWheel: wheel.wheel,
    zoomBy,
    zoomToWindow,
    fitAll,
    selection: lane.selection,
    laneDrag: lane.drag,
    laneHover,
  };
}
