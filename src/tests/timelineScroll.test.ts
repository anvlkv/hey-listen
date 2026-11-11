import { expect, it } from "vitest";
import { clampViewStart, thumbPercent } from "../lib/timelineScroll";

/**
 * Unit checks for the Timeline scrollbar's geometry (`src/lib/timelineScroll.ts`),
 * runnable without a browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * Covers the pure contract the scrollbar relies on: a pan never pushes the view past
 * either end of the source, and the thumb always sits inside its track (so a deep zoom
 * cannot show a thumb hanging off the edge). See `docs/ui-layout.md`.
 */

it("clamps a view start so the visible span stays inside the source", () => {
  expect(clampViewStart(2, 10, 4)).toBe(2);
  expect(clampViewStart(-1, 10, 4)).toBe(0);
  // The furthest a 4 s view can start in a 10 s source is 6 s.
  expect(clampViewStart(9, 10, 4)).toBe(6);
  // A span longer than the source cannot start anywhere but 0.
  expect(clampViewStart(3, 10, 20)).toBe(0);
});

it("places the thumb as a percentage of the whole source", () => {
  // Zoomed out: the thumb fills the track.
  expect(thumbPercent(0, 10, 10)).toEqual({ left: "0%", width: "100%" });
  expect(thumbPercent(5, 10, 10)).toEqual({ left: "50%", width: "50%" });
  expect(thumbPercent(2, 4, 10)).toEqual({ left: "20%", width: "20%" });
  // Out-of-range views clamp, so the thumb never leaves the track.
  expect(thumbPercent(-1, 3, 10)).toEqual({ left: "0%", width: "40%" });
  expect(thumbPercent(8, 12, 10)).toEqual({ left: "60%", width: "40%" });
  // No source: the thumb fills the track.
  expect(thumbPercent(0, 0, 0)).toEqual({ left: "0%", width: "100%" });
});
