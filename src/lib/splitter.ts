/**
 * Pointer-drag handling for the app's layout splitters (M15).
 *
 * The Timeline row, the Sidebar column and the Notes rail each resize themselves by
 * the same down / move / up pointer dance; this is the one implementation they share.
 * The handlers go straight onto a splitter `<div>` (`onPointerDown` etc.), so a caller
 * only describes its axis, its size store, and which way the pointer moves it.
 */
export interface SplitterHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
}

interface SplitterOptions {
  /** The drag axis: a column resizes on `x`, a row on `y`. */
  axis: "x" | "y";
  /** The current size (px), read at pointer-down to anchor the drag. */
  read: () => number;
  /** Store a new size (px). */
  write: (value: number) => void;
  /** Whether a growing coordinate grows the size (`1`) or shrinks it (`-1`). */
  sign?: 1 | -1;
  /** Optional clamp applied to every new size. */
  clamp?: (value: number) => number;
}

/** The `onPointerDown/Move/Up` triple for one splitter. */
export function createSplitter(options: SplitterOptions): SplitterHandlers {
  const sign = options.sign ?? 1;
  const coordinate = (event: PointerEvent) =>
    options.axis === "x" ? event.clientX : event.clientY;
  let drag: { origin: number; size: number } | null = null;

  const commit = (value: number) => options.write(options.clamp ? options.clamp(value) : value);

  return {
    onPointerDown(event) {
      const el = event.currentTarget as HTMLElement;
      drag = { origin: coordinate(event), size: options.read() };
      el.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove(event) {
      if (!drag) return;
      commit(drag.size + sign * (coordinate(event) - drag.origin));
    },
    onPointerUp(event) {
      drag = null;
      const el = event.currentTarget as HTMLElement;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    },
  };
}
