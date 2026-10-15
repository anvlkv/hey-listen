import { clampViewStart, thumbPercent } from "../src/lib/timelineScroll";
import { assertDeepEqual, assertEqual, check, report } from "./testHarness";

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

check("clamps a view start so the visible span stays inside the source", () => {
  assertEqual(clampViewStart(2, 10, 4), 2);
  assertEqual(clampViewStart(-1, 10, 4), 0);
  // The furthest a 4 s view can start in a 10 s source is 6 s.
  assertEqual(clampViewStart(9, 10, 4), 6);
  // A span longer than the source cannot start anywhere but 0.
  assertEqual(clampViewStart(3, 10, 20), 0);
});

check("places the thumb as a percentage of the whole source", () => {
  // Zoomed out: the thumb fills the track.
  assertDeepEqual(thumbPercent(0, 10, 10), { left: "0%", width: "100%" });
  assertDeepEqual(thumbPercent(5, 10, 10), { left: "50%", width: "50%" });
  assertDeepEqual(thumbPercent(2, 4, 10), { left: "20%", width: "20%" });
  // Out-of-range views clamp, so the thumb never leaves the track.
  assertDeepEqual(thumbPercent(-1, 3, 10), { left: "0%", width: "40%" });
  assertDeepEqual(thumbPercent(8, 12, 10), { left: "60%", width: "40%" });
  // No source: the thumb fills the track.
  assertDeepEqual(thumbPercent(0, 0, 0), { left: "0%", width: "100%" });
});

report("timelineScroll");
