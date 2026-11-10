import { assertEqual, check, report } from "./testHarness";
import { mean, percentile, present } from "../src/lib/percentiles";

/**
 * Unit checks for the shared percentile helpers (`src/lib/percentiles.ts`): the loudness
 * readouts call N5 "exceeded 5% of the time", so the percentile direction must be
 * pinned rather than inferred at each call site.
 */

function assertClose(actual: number, expected: number) {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

check("percentile interpolates between ranks", () => {
  assertClose(percentile([0, 10], 0.5), 5);
  assertClose(percentile([0, 10, 20], 0.5), 10);
  assertClose(percentile([0, 10, 20], 0.25), 5);
});

check("the 95th percentile is the level exceeded 5% of the time", () => {
  // Ascending sample: the top 5% lies above the 95th percentile.
  const values = Array.from({ length: 101 }, (_, index) => index);
  assertEqual(percentile(values, 0.95), 95);
  assertEqual(percentile(values, 0.05), 5);
});

check("percentiles clamp and handle the degenerate samples", () => {
  assertEqual(percentile([], 0.5), 0);
  assertEqual(percentile([7], 0.9), 7);
  assertEqual(percentile([1, 2, 3], -1), 1);
  assertEqual(percentile([1, 2, 3], 2), 3);
});

check("present drops gaps and non-finite values, and mean averages the rest", () => {
  assertEqual(present([0, null, Number.NaN, 4]).length, 2);
  assertClose(mean([0, 2, 4]), 2);
  assertEqual(mean([]), 0);
});

report("percentiles");
