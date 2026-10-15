import { type Accessor } from "solid-js";
import { stopFollowing } from "../../state/capture";
import { notesSorted } from "../../state/notes";
import { createLaneDrag, noteHandleAt, noteHintText, type LaneSelection } from "../notes/lane";
import { source } from "../../state/source";
import {
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "../../state/timeline";
import { HANDLE_HIT, MOVE_HIT, PREVIEW_THROTTLE, RULER_H } from "./constants";
import { NOTE_STRIP_H } from "../notes/strip";

/**
 * Pointer interaction for the Timeline canvas: drag to pan, drag the start/end
 * handles (with an edge preview), drag the move bar to slide the window, drag a note
 * handle / draw a note selection in the bottom lane, wheel-zoom, and the toolbar zoom
 * actions. The component-local capabilities arrive in [`TimelineInteractionDeps`]; the
 * shared store reads/writes are imported directly. See `docs/source-model.md`.
 */
type DragKind = "start" | "end" | "move" | "pan";

export interface TimelineInteractionDeps {
  canvas: () => HTMLCanvasElement;
  active: () => boolean;
  duration: () => number;
  t2x: (t: number) => number;
  x2t: (x: number) => number;
  span: () => number;
  plotW: () => number;
  applyView: (a: number, b: number) => void;
  setNoteHint: (hint: { x: number; y: number; text: string } | null) => void;
  previewEdge: (kind: "start" | "end") => void;
  endPreview: () => void;
}

export interface TimelineInteraction {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onWheel: (e: WheelEvent) => void;
  zoomBy: (factor: number) => void;
  zoomToWindow: () => void;
  fitAll: () => void;
  /** The span being dragged out in the note lane, for the canvas to draw. */
  selection: Accessor<LaneSelection>;
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
  /** Whether the note lane owns the current gesture (a handle drag or a selection). */
  let laneActive = false;
  let lastPreview = 0;

  /** The Timeline's lane holds **Timeline notes** (no chart). */
  const lane = createLaneDrag(() => ({
    notes: () => notesSorted(),
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

  /** The top of the bottom note lane (where notes are created, grabbed and resized). */
  function laneTop(): number {
    const rect = deps.canvas().getBoundingClientRect();
    return rect.height - NOTE_STRIP_H;
  }

  function minWindow(): number {
    const s = source();
    return Math.max(1e-3, s ? 4 / s.sampleRate : 1e-3);
  }

  function onPointerDown(e: PointerEvent) {
    if (!deps.active() || !source()) return;
    stopFollowing();
    const canvas = deps.canvas();
    const x = pointerX(e);
    const y = pointerY(e);

    // The note lane owns the bottom strip: grab a handle to move / resize a note, or
    // drag empty space to select a span for a new one.
    if (y >= laneTop() && lane.down(x)) {
      laneActive = true;
      deps.setNoteHint(null);
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const ws = deps.t2x(windowStart());
    const we = deps.t2x(windowEnd());

    let kind: DragKind = "pan";
    // Edge handles win at their x positions; the top bar covers the interior.
    if (Math.abs(x - ws) <= HANDLE_HIT) kind = "start";
    else if (Math.abs(x - we) <= HANDLE_HIT) kind = "end";
    else if (x > ws && x < we && y >= RULER_H && y <= RULER_H + MOVE_HIT) kind = "move";

    drag = {
      kind,
      pointerX: x,
      origViewStart: viewStart(),
      origViewEnd: viewEnd(),
      origWindowStart: windowStart(),
      origWindowEnd: windowEnd(),
    };
    canvas.setPointerCapture(e.pointerId);

    if (kind === "start" || kind === "end") {
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
      const hovered = y >= laneTop() ? noteHandleAt(notesSorted(), deps.t2x, x) : null;
      deps.setNoteHint(hovered ? { x, y, text: noteHintText(hovered.note) } : null);
      return;
    }
    const x = pointerX(e);

    if (drag.kind === "pan") {
      const dt = ((drag.pointerX - x) / deps.plotW()) * deps.span();
      deps.applyView(drag.origViewStart + dt, drag.origViewEnd + dt);
      return;
    }

    const s = source();
    if (!s) return;

    if (drag.kind === "move") {
      // Slide the whole window by the pointer delta, preserving its width and
      // keeping it inside [0, duration]. The viewport is left untouched.
      const dur = deps.duration();
      const wLen = drag.origWindowEnd - drag.origWindowStart;
      const dt = deps.x2t(x) - deps.x2t(drag.pointerX);
      const start = Math.max(0, Math.min(dur - wLen, drag.origWindowStart + dt));
      setWindowStart(start);
      setWindowEnd(start + wLen);
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

  function onPointerUp(e: PointerEvent) {
    const canvas = deps.canvas();
    if (laneActive) {
      laneActive = false;
      lane.up();
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      return;
    }
    if (!drag) return;
    // Only the edge handles preview + auto-zoom on release; move/pan do not.
    const wasEdge = drag.kind === "start" || drag.kind === "end";
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (wasEdge) {
      deps.endPreview();
      maybeAutoZoom();
    }
  }

  function maybeAutoZoom() {
    const s = source();
    if (!s || s.duration <= 0) return;
    const wDur = windowEnd() - windowStart();
    if (wDur > 0 && wDur <= s.duration * 0.05) {
      const pad = Math.max(wDur * 0.1, s.duration * 0.005);
      deps.applyView(Math.max(0, windowStart() - pad), Math.min(s.duration, windowEnd() + pad));
    }
  }

  function onWheel(e: WheelEvent) {
    if (!source()) return;
    stopFollowing();
    e.preventDefault();
    const t = deps.x2t(pointerX(e));
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    deps.applyView(t + (viewStart() - t) * factor, t + (viewEnd() - t) * factor);
  }

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
    onWheel,
    zoomBy,
    zoomToWindow,
    fitAll,
    selection: lane.selection,
  };
}
