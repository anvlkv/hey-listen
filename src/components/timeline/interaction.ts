import { stopFollowing } from "../../state/capture";
import { dragNoteTo, focusNote, refreshNoteValues, setFocusedNote } from "../../state/notes";
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
import { noteAt, noteHintText } from "./noteHit";

/**
 * Pointer interaction for the Timeline canvas: drag to pan, drag the start/end
 * handles (with an edge preview), drag the move bar to slide the window, drag note
 * pins, wheel-zoom, and the toolbar zoom actions. The component-local capabilities
 * arrive in [`TimelineInteractionDeps`]; the shared store reads/writes are imported
 * directly. See `docs/source-model.md`.
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
  /** Dragging a note pin along the timeline (M14). */
  let noteDrag: { id: string; startX: number; moved: boolean } | null = null;
  let lastPreview = 0;

  function pointerX(e: { clientX: number }): number {
    const rect = deps.canvas().getBoundingClientRect();
    return e.clientX - rect.left;
  }

  function pointerY(e: { clientY: number }): number {
    const rect = deps.canvas().getBoundingClientRect();
    return e.clientY - rect.top;
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

    // A note pin starts a drag (grab its tick, or click to focus + open its chart).
    const note = noteAt(x, y, deps.t2x);
    if (note) {
      noteDrag = { id: note.id, startX: x, moved: false };
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
    if (noteDrag) {
      const x = pointerX(e);
      if (Math.abs(x - noteDrag.startX) > 2) noteDrag.moved = true;
      if (noteDrag.moved) {
        const t = Math.max(0, Math.min(deps.duration(), deps.x2t(x)));
        dragNoteTo(noteDrag.id, t);
      }
      return;
    }
    if (!drag) {
      const hit = noteAt(pointerX(e), pointerY(e), deps.t2x);
      deps.setNoteHint(hit ? { x: pointerX(e), y: pointerY(e), text: noteHintText(hit) } : null);
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
    if (noteDrag) {
      const { id, moved } = noteDrag;
      noteDrag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (moved) {
        // Re-snapshot the values at the new time, and show the note where it landed.
        refreshNoteValues(id);
        setFocusedNote(id);
      } else {
        focusNote(id);
      }
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

  return { onPointerDown, onPointerMove, onPointerUp, onWheel, zoomBy, zoomToWindow, fitAll };
}
