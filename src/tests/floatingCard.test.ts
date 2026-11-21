import { describe, expect, it } from "vitest";
import {
  FLOATING_GAP,
  FLOATING_MARGIN,
  placeFloating,
  type FloatingViewport,
} from "../lib/floatingCard";

/** A 1000 × 600 window and a 200 × 150 card: room for all four quadrants. */
const VIEWPORT: FloatingViewport = { width: 1000, height: 600 };
const SIZE = { width: 200, height: 150 };

describe("placeFloating", () => {
  it("places the card below and to the right in the top-left quadrant", () => {
    const placement = placeFloating({ left: 100, top: 80 }, SIZE, VIEWPORT);
    expect(placement).toEqual({
      left: 100 + FLOATING_GAP,
      top: 80 + FLOATING_GAP,
      side: "below",
      align: "right",
    });
  });

  it("flips above but stays right in the bottom-left quadrant", () => {
    const placement = placeFloating({ left: 100, top: 500 }, SIZE, VIEWPORT);
    expect(placement).toEqual({
      left: 100 + FLOATING_GAP,
      top: 500 - FLOATING_GAP - SIZE.height,
      side: "above",
      align: "right",
    });
  });

  it("flips left but stays below in the top-right quadrant", () => {
    const placement = placeFloating({ left: 900, top: 80 }, SIZE, VIEWPORT);
    expect(placement).toEqual({
      left: 900 - FLOATING_GAP - SIZE.width,
      top: 80 + FLOATING_GAP,
      side: "below",
      align: "left",
    });
  });

  it("flips above and left in the bottom-right quadrant", () => {
    const placement = placeFloating({ left: 900, top: 500 }, SIZE, VIEWPORT);
    expect(placement).toEqual({
      left: 900 - FLOATING_GAP - SIZE.width,
      top: 500 - FLOATING_GAP - SIZE.height,
      side: "above",
      align: "left",
    });
  });

  it("keeps the card below when it does not fit above either", () => {
    const viewport = { width: 1000, height: 200 };
    const placement = placeFloating({ left: 100, top: 100 }, { width: 200, height: 150 }, viewport);
    // Below overflows and above starts off screen, so the card is clamped inside.
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(viewport.height - FLOATING_MARGIN - 150);
    expect(placement.left).toBe(100 + FLOATING_GAP);
  });

  it("clamps a card whose anchor is above and left of the viewport", () => {
    const placement = placeFloating({ left: -500, top: -500 }, SIZE, VIEWPORT);
    expect(placement.left).toBe(FLOATING_MARGIN);
    expect(placement.top).toBe(FLOATING_MARGIN);
  });

  it("clamps an oversized card to the top-left margin", () => {
    const viewport = { width: 300, height: 200 };
    const placement = placeFloating({ left: 20, top: 20 }, { width: 400, height: 300 }, viewport);
    expect(placement.left).toBe(FLOATING_MARGIN);
    expect(placement.top).toBe(FLOATING_MARGIN);
  });

  it("clamps the card back inside the right edge when flipping left would not fit", () => {
    const viewport = { width: 300, height: 600 };
    const placement = placeFloating({ left: 150, top: 100 }, { width: 200, height: 150 }, viewport);
    expect(placement.align).toBe("right");
    expect(placement.left).toBe(viewport.width - FLOATING_MARGIN - 200);
  });

  it("honours custom gap and margin options", () => {
    const placement = placeFloating({ left: 10, top: 10 }, SIZE, VIEWPORT, { gap: 0, margin: 0 });
    expect(placement).toEqual({ left: 10, top: 10, side: "below", align: "right" });
  });

  it("does not flip left when the flipped card would leave the left edge", () => {
    const placement = placeFloating({ left: 500, top: 100 }, { width: 500, height: 100 }, VIEWPORT);
    // Flipping left would start at -12 px, so the card keeps its right side and clamps.
    expect(placement.align).toBe("right");
    expect(placement.left).toBe(VIEWPORT.width - FLOATING_MARGIN - 500);
  });
});
