import { expect, it } from "vitest";
import {
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
  WHEEL_ZOOM_CLAMP_PX,
  WHEEL_ZOOM_RATE,
  wheelIntent,
  wheelPixels,
  wheelZoomFactor,
} from "../lib/wheelGesture";

/**
 * Unit checks for the shared wheel/trackpad gesture math (`src/lib/wheelGesture.ts`),
 * runnable without a browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * Covers the pure half of the M23 contract: `deltaMode` is normalized to pixels, a plain
 * vertical wheel zooms (a mouse needs no modifier) while a horizontal-dominant gesture or
 * `Shift` + vertical pans, and the zoom factor is a clamped exponential rather than a
 * fixed step.
 */

it("normalizes every deltaMode to CSS pixels", () => {
  expect(wheelPixels({ deltaX: 3, deltaY: -4, deltaMode: 0 })).toEqual({ x: 3, y: -4 });
  expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 1 })).toEqual({ x: 0, y: WHEEL_LINE_PX });
  expect(wheelPixels({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toEqual({
    x: 0,
    y: WHEEL_PAGE_PX,
  });
});

it("zooms a vertical wheel and pans a horizontal or Shift gesture", () => {
  const vertical = { x: 0, y: -30 };
  const horizontal = { x: 40, y: -10 };
  // A plain vertical wheel zooms, so a mouse user needs no modifier.
  expect(wheelIntent(vertical, false, false)).toBe("zoom");
  // Shift + vertical pans (a trackpad's two-finger scroll).
  expect(wheelIntent(vertical, true, false)).toBe("pan");
  // A horizontal swipe is always a pan, even with Ctrl/⌘ held.
  expect(wheelIntent(horizontal, false, false)).toBe("pan");
  expect(wheelIntent(horizontal, false, true)).toBe("pan");
  // A pinch zooms, and wins over Shift so a 2-D chart keeps its frequency-axis zoom.
  expect(wheelIntent(vertical, false, true)).toBe("zoom");
  expect(wheelIntent(vertical, true, true)).toBe("zoom");
});

it("scales the zoom exponentially and clamps a runaway delta", () => {
  expect(wheelZoomFactor(0)).toBe(1);
  // A 100 px pinch zooms in by ~1.22×; scrolling the other way zooms out by the reciprocal.
  expect(wheelZoomFactor(100)).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_RATE), 10);
  expect(wheelZoomFactor(-100)).toBeCloseTo(1 / Math.exp(100 * WHEEL_ZOOM_RATE), 10);
  // Past the clamp, a bigger delta cannot zoom harder.
  expect(wheelZoomFactor(WHEEL_ZOOM_CLAMP_PX * 10)).toBe(wheelZoomFactor(WHEEL_ZOOM_CLAMP_PX));
  expect(wheelZoomFactor(-WHEEL_ZOOM_CLAMP_PX * 10)).toBe(wheelZoomFactor(-WHEEL_ZOOM_CLAMP_PX));
});
