import { METER_FLOOR_DB, METER_FLOOR_LINEAR, meterDbLabel, meterPercent } from "../src/lib/format";
import { assertEqual, check, report } from "./testHarness";

/**
 * Unit checks for the shared meter math (`src/lib/format.ts`): the fill and the
 * readout must agree on the −60 dBFS floor, and a decaying level must never leak an
 * unbounded (or non-finite) dB value into the UI.
 */

/** Compare with a tolerance, for the non-integer percentages. */
function assertClose(actual: number, expected: number) {
  if (Math.abs(actual - expected) > 1e-6) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}

check("silence is an empty meter and a dash", () => {
  assertEqual(meterPercent(0), 0);
  assertEqual(meterDbLabel(0), "—");
});

check("full scale is a full meter at 0 dBFS", () => {
  assertEqual(meterPercent(1), 100);
  assertEqual(meterDbLabel(1), "0 dB");
});

check("half scale reads −6 dB on a 90% fill", () => {
  assertClose(meterPercent(0.5), ((-6.0206 + 60) / 60) * 100);
  assertEqual(meterDbLabel(0.5), "-6 dB");
});

check("the meter floor is shared by the fill and the readout", () => {
  assertEqual(meterPercent(METER_FLOOR_LINEAR), 0);
  assertEqual(meterDbLabel(METER_FLOOR_LINEAR), `${METER_FLOOR_DB} dB`);
});

check("a decaying tail never prints a runaway dB value", () => {
  // The bug: a peak-hold that decays for a few seconds reached ≈1e-150, so the
  // readout said "-3000 dB" while the fill was already empty.
  assertEqual(meterPercent(1e-150), 0);
  assertEqual(meterDbLabel(1e-150), "< -60 dB");
});

check("non-finite amplitudes fall back to silence", () => {
  assertEqual(meterPercent(Number.NaN), 0);
  assertEqual(meterDbLabel(Number.NaN), "—");
  assertEqual(meterPercent(Number.POSITIVE_INFINITY), 0);
  assertEqual(meterDbLabel(Number.POSITIVE_INFINITY), "—");
});

check('levels just under 0 dBFS do not render as "-0 dB"', () => {
  assertEqual(meterDbLabel(0.99), "0 dB");
});

report("format");
