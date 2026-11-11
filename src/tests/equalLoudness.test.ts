import { expect, it } from "vitest";
import {
  contourAt,
  contourLevels,
  EQ_LOUDNESS_FREQS,
  EQ_LOUDNESS_PHONS,
} from "../lib/equalLoudness";

/**
 * Checks for the equal-loudness reference table (`src/lib/equalLoudness.ts`).
 *
 * The expectations below are **literals** from ISO 226:2023 Table 1 at preferred
 * third-octave frequencies, not values looked up from the shipped table, so the test
 * would catch a silent edit to the table. The 1 kHz points are definitional; the other
 * anchors are non-1 kHz. The interpolation cases sit between two tabulated frequencies
 * on the log-frequency axis, and the clamp cases lie outside the 20 Hz–12.5 kHz range.
 */

/** ISO 226:2023 Table 1 levels (dB SPL) at preferred frequencies, independent of the module. */
const ISO_226_LEVELS: readonly { phon: number; freq: number; db: number }[] = [
  { phon: 20, freq: 100, db: 48.6 },
  { phon: 20, freq: 1000, db: 20.0 },
  { phon: 40, freq: 63, db: 73.0 },
  { phon: 40, freq: 100, db: 64.2 },
  { phon: 40, freq: 500, db: 43.1 },
  { phon: 40, freq: 2000, db: 39.2 },
  { phon: 40, freq: 5000, db: 40.1 },
  { phon: 40, freq: 10000, db: 54.4 },
  { phon: 60, freq: 100, db: 78.5 },
  { phon: 60, freq: 4000, db: 57.7 },
  { phon: 80, freq: 6300, db: 86.9 },
];

it("every offered phon level has a full contour", () => {
  for (const phon of EQ_LOUDNESS_PHONS) {
    expect(contourLevels(phon)?.length).toBe(EQ_LOUDNESS_FREQS.length);
  }
});

it("a 1 kHz tone at N phon reads N dB SPL", () => {
  for (const phon of EQ_LOUDNESS_PHONS) expect(contourAt(phon, 1000)).toBeCloseTo(phon, 1);
});

it("the table matches ISO 226:2023 at non-1 kHz preferred frequencies", () => {
  for (const { phon, freq, db } of ISO_226_LEVELS) {
    expect(contourAt(phon, freq)).toBeCloseTo(db, 1);
  }
});

it("interior frequencies interpolate linearly in log-frequency", () => {
  // Each frequency is the geometric mean of its two neighbouring preferred
  // frequencies, so a log-frequency interpolation lands at t = 0.5 (the mean of the
  // two literals). Linear-in-frequency interpolation would miss these values.
  const cases = [
    { phon: 40, freq: Math.sqrt(100 * 125), expected: (64.2 + 60.4) / 2 },
    { phon: 60, freq: Math.sqrt(1000 * 1250), expected: (60.0 + 62.1) / 2 },
    { phon: 80, freq: Math.sqrt(500 * 630), expected: (80.9 + 80.1) / 2 },
  ];
  for (const { phon, freq, expected } of cases) {
    expect(contourAt(phon, freq)).toBeCloseTo(expected, 6);
  }
});

it("the table clamps beyond 20 Hz–12.5 kHz", () => {
  // 40 phon: the first/last tabulated levels are 99.7 dB (20 Hz) and 51.3 dB (12.5 kHz).
  expect(contourAt(40, 1)).toBeCloseTo(99.7, 6);
  expect(contourAt(40, 19.999)).toBeCloseTo(99.7, 6);
  expect(contourAt(40, 12500)).toBeCloseTo(51.3, 6);
  expect(contourAt(40, 20000)).toBeCloseTo(51.3, 6);
});

it("non-positive or non-finite frequencies have no value", () => {
  for (const freq of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(contourAt(40, freq)).toBeNull();
  }
});

it("an untabulated phon level has no contour", () => {
  expect(contourAt(25, 1000)).toBeNull();
  expect(contourLevels(25)).toBeNull();
});
