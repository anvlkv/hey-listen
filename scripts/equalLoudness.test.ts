import {
  contourAt,
  contourLevels,
  EQ_LOUDNESS_FREQS,
  EQ_LOUDNESS_PHONS,
} from "../src/lib/equalLoudness";
import { assertEqual, check, report } from "./testHarness";

/**
 * Checks for the equal-loudness reference table (`src/lib/equalLoudness.ts`): the
 * 1 kHz point of a phon contour is that phon level by definition, interpolation
 * reproduces the tabulated values exactly at the table's frequencies, and asking
 * outside the table clamps rather than extrapolating.
 */

/** Compare with a tolerance, for the interpolated / rounded table values. */
function assertClose(actual: number | null, expected: number, tolerance = 1e-6) {
  if (actual == null || Math.abs(actual - expected) > tolerance) {
    throw new Error(`expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

check("every offered phon level has a full contour", () => {
  for (const phon of EQ_LOUDNESS_PHONS) {
    assertEqual(contourLevels(phon)?.length, EQ_LOUDNESS_FREQS.length);
  }
});

check("a 1 kHz tone at N phon reads N dB SPL", () => {
  for (const phon of EQ_LOUDNESS_PHONS) assertClose(contourAt(phon, 1000), phon, 0.05);
});

check("a tabulated frequency returns its tabulated value", () => {
  for (const phon of EQ_LOUDNESS_PHONS) {
    const levels = contourLevels(phon)!;
    EQ_LOUDNESS_FREQS.forEach((freq, index) => {
      assertClose(contourAt(phon, freq), levels[index]);
    });
  }
});

check("the table clamps outside its frequency range", () => {
  for (const phon of EQ_LOUDNESS_PHONS) {
    const levels = contourLevels(phon)!;
    assertClose(contourAt(phon, 1), levels[0]);
    assertClose(contourAt(phon, 20_000), levels[levels.length - 1]);
  }
});

check("an untabulated phon level has no contour", () => {
  assertEqual(contourAt(25, 1000), null);
  assertEqual(contourLevels(25), null);
});

report("equalLoudness");
