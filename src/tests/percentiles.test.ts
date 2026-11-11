import { expect, it } from "vitest";
import { mean, percentile, present } from "../lib/percentiles";

/**
 * Unit checks for the shared percentile helpers (`src/lib/percentiles.ts`): the loudness
 * readouts call N5 "exceeded 5% of the time", so the percentile direction must be
 * pinned rather than inferred at each call site.
 */

it("percentile interpolates between ranks", () => {
  expect(percentile([0, 10], 0.5)).toBeCloseTo(5, 9);
  expect(percentile([0, 10, 20], 0.5)).toBeCloseTo(10, 9);
  expect(percentile([0, 10, 20], 0.25)).toBeCloseTo(5, 9);
});

it("the 95th percentile is the level exceeded 5% of the time", () => {
  // Ascending sample: the top 5% lies above the 95th percentile.
  const values = Array.from({ length: 101 }, (_, index) => index);
  expect(percentile(values, 0.95)).toBe(95);
  expect(percentile(values, 0.05)).toBe(5);
});

it("percentiles clamp and handle the degenerate samples", () => {
  expect(percentile([], 0.5)).toBe(0);
  expect(percentile([7], 0.9)).toBe(7);
  expect(percentile([1, 2, 3], -1)).toBe(1);
  expect(percentile([1, 2, 3], 2)).toBe(3);
});

it("present drops gaps and non-finite values, and mean averages the rest", () => {
  expect(present([0, null, Number.NaN, 4]).length).toBe(2);
  expect(mean([0, 2, 4])).toBeCloseTo(2, 9);
  expect(mean([])).toBe(0);
});
