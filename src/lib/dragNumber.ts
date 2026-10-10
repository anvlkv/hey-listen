import { createSignal } from "solid-js";

/**
 * Drag-to-adjust for numeric inputs (M7).
 *
 * Attaches pointer handlers to a numeric `<input>` so the value can be changed by
 * dragging **up to increase** / **down to decrease**, in addition to typing. There
 * is no slider — a `ns-resize` cursor (and a `num-dragging` class while dragging)
 * is the only affordance. Hold **Shift** for fine control.
 *
 * The caller supplies the current value and a setter; the setter is expected to
 * clamp (and, where the field is discrete, snap) the value it is given.
 */
export interface NumberDragOptions {
  /** The current value (read at drag start). */
  value: () => number;
  /** Commit a value while dragging. */
  onInput: (value: number) => void;
  /** Value increment per `sensitivity` pixels. */
  step: number;
  min?: number;
  max?: number;
  /** Vertical pixels per increment (smaller = faster). Default `4`. */
  sensitivity?: number;
  /** Increment multiplier while Shift is held, for fine control. Default `0.1`. */
  fine?: number;
}

export interface NumberDrag {
  /** True while a drag is actually changing the value (for the visual hint). */
  dragging: () => boolean;
  /** Pointer handlers to spread onto the input element. */
  handlers: {
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onPointerCancel: (event: PointerEvent) => void;
  };
}

export function createNumberDrag(options: NumberDragOptions): NumberDrag {
  const [dragging, setDragging] = createSignal(false);
  const sensitivity = options.sensitivity ?? 4;
  const fine = options.fine ?? 0.1;
  let start: { y: number; value: number } | null = null;
  let moved = false;

  const clamp = (value: number) => {
    let next = value;
    if (options.min != null) next = Math.max(options.min, next);
    if (options.max != null) next = Math.min(options.max, next);
    return next;
  };

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    start = { y: event.clientY, value: options.value() };
    moved = false;
    // Capture so the drag keeps following the pointer outside the input. A plain
    // click still focuses/types: we only preventDefault once the drag begins.
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (!start) return;
    const dy = start.y - event.clientY; // dragging up = increase
    if (!moved) {
      if (Math.abs(dy) < 3) return; // below the threshold it's a click
      moved = true;
      setDragging(true);
    }
    event.preventDefault();
    const increment = options.step * (event.shiftKey ? fine : 1);
    const value = start.value + Math.round(dy / sensitivity) * increment;
    options.onInput(clamp(value));
  }

  function onPointerUp(event: PointerEvent) {
    start = null;
    if (moved) event.preventDefault();
    moved = false;
    setDragging(false);
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
