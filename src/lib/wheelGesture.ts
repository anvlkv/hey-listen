/**
 * One wheel/trackpad gesture model for every zoomable surface (M23): the Timeline, the
 * uPlot charts and the canvas heatmaps all route their wheel events through
 * [`createWheelGesture`], so the semantics agree everywhere they are synced.
 *
 * - A **vertical** wheel **zooms** at the pointer (a mouse wheel needs no modifier), and
 *   so does a trackpad pinch (`Ctrl`/`⌘` + wheel).
 * - A horizontal-dominant gesture **pans**, and so does `Shift` + vertical (a trackpad's
 *   two-finger scroll becomes a pan).
 * - Deltas are normalized from `deltaMode` to CSS pixels, sub-pixel jitter is dropped,
 *   and a zoom uses a clamped exponential factor instead of a fixed step per event.
 * - Deltas accumulate and apply at most once per animation frame, and the intent resets
 *   after [`WHEEL_QUIET_MS`] of quiet (or as soon as a modifier changes), so a momentum
 *   tail cannot change the gesture mid-burst.
 *
 * Dependency-free — the math is pure and unit-tested, and the stateful wrapper only uses
 * `requestAnimationFrame`.
 */

/** The subset of a `WheelEvent` the gesture math reads. */
export type WheelDelta = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">;

/** A wheel delta converted to CSS pixels. */
export interface WheelPixels {
  x: number;
  y: number;
}

/** What a burst of wheel events is doing: `zoom` (a vertical wheel / pinch) or `pan`. */
export type WheelIntent = "pan" | "zoom";

/**
 * One animation frame's worth of a gesture, already accumulated. A host distinguishes
 * the two by `kind` and reads `dx`/`dy` (pan, CSS pixels) or `factor` (zoom, `< 1` zooms
 * in) accordingly. The pointer position is the latest event's, for an anchored zoom.
 */
export type WheelGesture =
  | { kind: "pan"; dx: number; dy: number; shift: boolean; clientX: number; clientY: number }
  | { kind: "zoom"; factor: number; shift: boolean; clientX: number; clientY: number };

/** Quiet time (ms) that ends a wheel burst. */
export const WHEEL_QUIET_MS = 150;
/** Deltas below this many pixels (both axes) are jitter, not a gesture. */
export const WHEEL_JITTER_PX = 0.5;
/** Pixels a `DOM_DELTA_LINE` delta stands for. */
export const WHEEL_LINE_PX = 16;
/** Pixels a `DOM_DELTA_PAGE` delta stands for (the zoom clamp makes the exact value moot). */
export const WHEEL_PAGE_PX = 400;
/** The largest zoom delta (±) that counts, so one event can never run away. */
export const WHEEL_ZOOM_CLAMP_PX = 120;
/**
 * The zoom curve's rate: `exp(deltaPx * rate)`. A 100 px pinch is ~1.22×; the sign
 * matches the old step (a scroll up, `deltaY < 0`, zooms **in**).
 */
export const WHEEL_ZOOM_RATE = 0.002;

/** Convert a wheel delta to CSS pixels, by `deltaMode` (pixel / line / page). */
export function wheelPixels(event: WheelDelta): WheelPixels {
  const scale = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

/**
 * The gesture a burst starts with. A vertical wheel **zooms** — a plain mouse wheel needs
 * no modifier — while a horizontal-dominant delta or `Shift` + vertical **pans**.
 * `pinch` (`Ctrl`/`⌘`) is a zoom too and wins over `Shift`, so a 2-D chart can still
 * select its frequency axis with `Ctrl`/`⌘` + `Shift` + wheel.
 */
export function wheelIntent(pixels: WheelPixels, shift: boolean, pinch: boolean): WheelIntent {
  if (Math.abs(pixels.x) > Math.abs(pixels.y)) return "pan";
  if (shift && !pinch) return "pan";
  return "zoom";
}

/** The continuous zoom factor for an accumulated vertical delta (`< 1` zooms in). */
export function wheelZoomFactor(deltaPx: number): number {
  const clamped = Math.max(-WHEEL_ZOOM_CLAMP_PX, Math.min(WHEEL_ZOOM_CLAMP_PX, deltaPx));
  return Math.exp(clamped * WHEEL_ZOOM_RATE);
}

/** What a [`createWheelGesture`] host supplies. */
export interface WheelGestureOptions {
  /** Receive one accumulated gesture per animation frame. */
  apply: (gesture: WheelGesture) => void;
  /**
   * Whether the host can consume a wheel right now (no source, no chart → leave it to
   * the page). A consumable wheel is always `preventDefault`ed.
   */
  enabled?: () => boolean;
}

/** The wheel listener [`createWheelGesture`] returns. */
export interface WheelGestureHandler {
  /** Attach to the host with `{ passive: false }`. */
  wheel: (event: WheelEvent) => void;
  /** Cancel a pending frame and forget the burst (call on cleanup). */
  dispose: () => void;
}

/**
 * Create the per-host wheel gesture: one intent per burst, accumulated deltas, one
 * `apply` per animation frame.
 */
export function createWheelGesture(options: WheelGestureOptions): WheelGestureHandler {
  let intent: WheelIntent | null = null;
  let lastAt = 0;
  let dx = 0;
  let dy = 0;
  let shift = false;
  let clientX = 0;
  let clientY = 0;
  /** The modifiers the burst's intent was chosen with (`null` between bursts). */
  let mods: { shift: boolean; pinch: boolean } | null = null;
  let frame: number | null = null;

  const forget = () => {
    intent = null;
    mods = null;
    dx = 0;
    dy = 0;
  };

  const flush = () => {
    frame = null;
    const active = intent;
    if (!active) return;
    if (active === "zoom") {
      // A vertical wheel / pinch's vertical component is the signal.
      if (dy === 0) return;
      options.apply({
        kind: "zoom",
        factor: wheelZoomFactor(dy),
        shift,
        clientX,
        clientY,
      });
    } else {
      if (dx === 0 && dy === 0) return;
      options.apply({ kind: "pan", dx, dy, shift, clientX, clientY });
    }
    dx = 0;
    dy = 0;
  };

  const wheel = (event: WheelEvent) => {
    if (options.enabled && !options.enabled()) return;
    // Consume the wheel so the WebView never scrolls under the plot.
    event.preventDefault();

    const pixels = wheelPixels(event);
    const now = performance.now();
    const current = { shift: event.shiftKey, pinch: event.ctrlKey || event.metaKey };
    // A quiet gap or a changed modifier ends the burst: the next event starts fresh, so
    // a gesture that starts as a zoom does not turn into a pan mid-momentum (and back).
    const modsChanged =
      mods != null && (mods.shift !== current.shift || mods.pinch !== current.pinch);
    if (now - lastAt > WHEEL_QUIET_MS || modsChanged) forget();
    lastAt = now;
    mods = current;
    if (!intent) intent = wheelIntent(pixels, current.shift, current.pinch);

    // Sub-pixel events extend the burst but contribute nothing.
    if (Math.abs(pixels.x) >= WHEEL_JITTER_PX) dx += pixels.x;
    if (Math.abs(pixels.y) >= WHEEL_JITTER_PX) dy += pixels.y;
    shift = current.shift;
    clientX = event.clientX;
    clientY = event.clientY;

    if (frame === null) frame = requestAnimationFrame(flush);
  };

  const dispose = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    forget();
  };

  return { wheel, dispose };
}
