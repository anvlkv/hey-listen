/**
 * Where a floating card (a hover readout) sits on screen.
 *
 * A chart's readout is anchored to the cursor, but it must never leave the window: the
 * cursor can sit anywhere in a tall chart, and a tall card near the bottom edge would
 * be cut off by the screen. So placement is measured — anchor, card size and viewport
 * in CSS px — and decided in one pure step, testable without a DOM:
 *
 * - **preferred** below and to the right of the anchor;
 * - **flips above** when the card does not fit below (but only when it fits above);
 * - **flips left** when it would cross the viewport's right edge;
 * - **clamped** into the viewport with an 8 px margin either way, which is what keeps
 *   an oversized card's top-left on screen while CSS limits its height.
 *
 * Coordinates are **viewport** px, i.e. what `position: fixed` consumes; callers feed
 * it `getBoundingClientRect()` values, not document offsets.
 */

/** A point in viewport px, e.g. the cursor under the pointer. */
export interface FloatingAnchor {
  left: number;
  top: number;
}

/** The card's measured box, in CSS px. */
export interface FloatingSize {
  width: number;
  height: number;
}

/** The window's inner size, in CSS px. */
export interface FloatingViewport {
  width: number;
  height: number;
}

/** The default space between the anchor and the card. */
export const FLOATING_GAP = 12;

/** The default space the card keeps from every viewport edge. */
export const FLOATING_MARGIN = 8;

export interface FloatingOptions {
  /** Space between the anchor and the card (default {@link FLOATING_GAP}). */
  gap?: number;
  /** Space kept from every viewport edge (default {@link FLOATING_MARGIN}). */
  margin?: number;
}

export interface FloatingPlacement {
  /** Viewport px, for `position: fixed`. */
  left: number;
  /** Viewport px, for `position: fixed`. */
  top: number;
  /** Whether the card is below or above the anchor. */
  side: "below" | "above";
  /** Whether the card is to the right or the left of the anchor. */
  align: "right" | "left";
}

/** Clamp `value` into `[min, max]`, letting an impossible range collapse to `min`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Place a card of `size` next to `anchor` inside `viewport`.
 *
 * The returned `side` / `align` name the direction the card ended up on, so a caller
 * can style the card's arrow (or pick an entrance animation) without re-deriving the
 * decision. The card is always at least `margin` from every viewport edge.
 */
export function placeFloating(
  anchor: FloatingAnchor,
  size: FloatingSize,
  viewport: FloatingViewport,
  opts: FloatingOptions = {},
): FloatingPlacement {
  const gap = opts.gap ?? FLOATING_GAP;
  const margin = opts.margin ?? FLOATING_MARGIN;

  const maxLeft = viewport.width - margin - size.width;
  const maxTop = viewport.height - margin - size.height;

  const right = anchor.left + gap;
  const flippedLeft = anchor.left - gap - size.width;
  // Flip to the anchor's left only when the right side crosses the viewport's right
  // edge and the flipped card still clears the left one; otherwise keep "right" and
  // let the clamp decide.
  const align: FloatingPlacement["align"] =
    right > maxLeft && flippedLeft >= margin ? "left" : "right";
  const desiredLeft = align === "right" ? right : flippedLeft;

  const below = anchor.top + gap;
  const above = anchor.top - gap - size.height;
  const belowFits = below <= maxTop;
  // Flip above only when the card actually fits there; an oversized card stays below
  // and is clamped, with CSS capping its height.
  const side: FloatingPlacement["side"] = belowFits || above < margin ? "below" : "above";
  const desiredTop = side === "below" ? below : above;

  return {
    left: clamp(desiredLeft, margin, maxLeft),
    top: clamp(desiredTop, margin, maxTop),
    side,
    align,
  };
}
