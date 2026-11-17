import { batch, createSignal, onCleanup, type Accessor } from "solid-js";
import { seek } from "../../audio/preview";
import { setChannel } from "../../state/analysis";
import { stopFollowing } from "../../state/capture";
import { annotationsSorted } from "../../state/annotations";
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
import { HANDLE_HIT, MOVE_HIT, PREVIEW_THROTTLE, RULER_DRAG_PX, RULER_H } from "./constants";
import { formatTime } from "./format";
import { ANNOTATION_STRIP_H } from "../annotations/strip";
import { channelLaneAt, minWindowFor, selectWindow, type WindowSpan } from "./selection";
import { createTimelineZoom } from "./zoom";

/**
 * Pointer interaction for the Timeline canvas: drag the start/end handles (with an edge
 * preview), drag the move bar to slide the window, **select** a new window with a plain
 * left drag (in the waveform body **or** the ruler), **pan** with the middle button, drag an
 * annotation handle / draw an annotation selection in the bottom lane, wheel zoom/pan, and
 * the toolbar zoom actions. The component-local capabilities arrive in
 * [`TimelineInteractionDeps`]; the shared store reads/writes are imported directly. See
 * `docs/source-model.md` and `docs/roadmap.md` → M23 → "Window readout, pan and select" and
 * "Wheel and trackpad stability".
 */
type DragKind = "start" | "end" | "move" | "pan" | "select" | "ruler";

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
  /** The annotation lane's live selection span, for the canvas to draw. */
  selection: Accessor<LaneSelection>;
  /** The analysis window being dragged out (times), for the selection rectangle. */
  windowSelection: Accessor<WindowSpan | null>;
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
    /** A ruler press only becomes a selection once the pointer moves past the jitter. */
    moved: boolean;
  } | null = null;
  /** Whether the annotation lane owns the current gesture (a handle drag or a selection). */
  let laneActive = false;
  let lastPreview = 0;
  /** The annotation under the pointer in the lane: drawn with full-height rules + label. */
  const [laneHover, setLaneHover] = createSignal<string | null>(null);
  /** The window being dragged out, so the canvas can draw the selection rectangle. */
  const [windowSelection, setWindowSelection] = createSignal<WindowSpan | null>(null);

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
    return minWindowFor(source()?.sampleRate);
  }

  function clampTime(t: number): number {
    return Math.max(0, Math.min(deps.duration(), t));
  }

  /** The channel lane under a pointer y (a 2+ channel source draws one lane per channel). */
  function laneUnder(y: number): number | null {
    const s = source();
    if (!s) return null;
    const rect = deps.canvas().getBoundingClientRect();
    return channelLaneAt(y, RULER_H, rect.height - RULER_H, s.channels);
  }

  /** Apply a text-like selection from the drag's anchor to the pointer, and report it. */
  function applySelection(anchorPx: number, x: number, e: PointerEvent) {
    const span = selectWindow(deps.x2t(anchorPx), deps.x2t(x), deps.duration(), minWindow());
    setWindowSelection(span);
    reframeWindow(span);
    deps.setAnnotationHint({
      x,
      y: pointerY(e),
      text: `${formatTime(span.start)} → ${formatTime(span.end)}`,
    });
  }

  /**
   * Capture the pointer for the rest of a gesture. Best-effort: a synthetic pointer (the
   * E2E helpers dispatch one) has no active id; the gesture still works.
   */
  function capturePointer(pointerId: number) {
    try {
      deps.canvas().setPointerCapture(pointerId);
    } catch {
      // No active pointer to capture; the pointer events still arrive.
    }
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
      moved: false,
    };
    capturePointer(pointerId);
  }

  function onPointerDown(e: PointerEvent) {
    if (!deps.active() || !source()) return;
    stopFollowing();
    const x = pointerX(e);
    const y = pointerY(e);

    // Middle-button drag pans the view; the primary button selects a window.
    if (e.button === 1) {
      e.preventDefault(); // stop the WebView's middle-click autoscroll
      beginDrag("pan", x, e.pointerId);
      return;
    }
    if (e.button !== 0) return;

    // The ruler (top strip) **seeks** on a click and **selects** a window on a drag; the
    // intent is decided when the pointer moves past the jitter threshold.
    if (y < RULER_H) {
      beginDrag("ruler", x, e.pointerId);
      return;
    }

    // The annotation lane owns the bottom strip: grab a handle to move / resize an annotation, or
    // drag empty space to select a span for a new one.
    if (y >= laneTop() && lane.down(x)) {
      laneActive = true;
      setLaneHover(null);
      deps.setAnnotationHint(null);
      capturePointer(e.pointerId);
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
      // A text-like selection starts collapsed at the pointer; the window itself is only
      // touched once the pointer actually moves, so a plain click leaves it unchanged. The
      // lane the drag starts in becomes the analysis channel (one channel or "mix").
      const lane = laneUnder(y);
      if (lane != null) setChannel(lane);
      const anchor = clampTime(deps.x2t(x));
      setWindowSelection({ start: anchor, end: anchor });
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

    if (drag.kind === "ruler") {
      // A click seeks; only a real drag becomes a window selection.
      if (!drag.moved && Math.abs(x - drag.pointerX) < RULER_DRAG_PX) return;
      drag.moved = true;
      applySelection(drag.pointerX, x, e);
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
      drag.moved = true;
      applySelection(drag.pointerX, x, e);
      return;
    }

    if (drag.kind === "move") {
      // Slide the whole window by the pointer delta, preserving its width and staying inside
      // [0, duration]; the viewport is untouched. Both ends are written in one transaction:
      // unbatched, each write would run every window-dependent effect (repaint, analysis
      // debounce, chart re-fit, history, cross-window push) on its own, doubling the cost of
      // a pointer-rate gesture.
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
    const { kind, origWindowStart, origWindowEnd, moved } = drag;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    // A ruler click (no movement) seeks the transport playhead.
    if (kind === "ruler" && !moved) {
      seek(clampTime(deps.x2t(pointerX(e))));
      return;
    }

    // A selection and an edge drag both commit and reframe; move/pan do not (a playing
    // window preview follows the move via `audio/preview.ts`).
    if (kind !== "select" && kind !== "ruler" && kind !== "start" && kind !== "end") return;
    if (kind === "select" || kind === "ruler") {
      deps.setAnnotationHint(null);
      // A plain click in the body (or a sub-threshold ruler press) is a no-op: a body
      // click never touched the window, so there is nothing to restore.
      if (!moved) {
        setWindowSelection(null);
        return;
      }
      if (windowEnd() - windowStart() < minWindow()) {
        setWindowSelection(null);
        reframeWindow({ start: origWindowStart, end: origWindowEnd });
        return;
      }
      reframeWindow({ start: windowStart(), end: windowEnd(), frame: true });
      setWindowSelection(null);
      return;
    }
    deps.endPreview();
    reframeWindow({ start: windowStart(), end: windowEnd(), frame: true });
  }

  /** `Escape` during a selection drag puts the window back where it was. */
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || (drag?.kind !== "select" && drag?.kind !== "ruler")) return;
    e.preventDefault();
    const { origWindowStart, origWindowEnd } = drag;
    drag = null;
    setWindowSelection(null);
    reframeWindow({ start: origWindowStart, end: origWindowEnd });
    deps.setAnnotationHint(null);
  }

  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  /**
   * A vertical wheel **zooms** around the pointer; a horizontal wheel or `Shift` + vertical
   * **pans** the time axis. There is no vertical waveform zoom. See
   * `lib/wheelGesture.ts` → `wheelIntent`.
   */
  const zoom = createTimelineZoom({
    canvas: deps.canvas,
    duration: deps.duration,
    x2t: deps.x2t,
    span: deps.span,
    plotW: deps.plotW,
    applyView: deps.applyView,
  });

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onWheel: zoom.onWheel,
    zoomBy: zoom.zoomBy,
    zoomToWindow: zoom.zoomToWindow,
    fitAll: zoom.fitAll,
    selection: lane.selection,
    windowSelection,
    laneDrag: lane.drag,
    laneHover,
  };
}
