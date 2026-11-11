import { expect, it } from "vitest";
import { METER_FLOOR_DB, METER_FLOOR_LINEAR, meterDbLabel, meterPercent } from "../lib/format";

/**
 * Unit checks for the shared meter math (`src/lib/format.ts`): the fill and the
 * readout must agree on the −60 dBFS floor, and a decaying level must never leak an
 * unbounded (or non-finite) dB value into the UI.
 */

it("silence is an empty meter and a dash", () => {
  expect(meterPercent(0)).toBe(0);
  expect(meterDbLabel(0)).toBe("—");
});

it("full scale is a full meter at 0 dBFS", () => {
  expect(meterPercent(1)).toBe(100);
  expect(meterDbLabel(1)).toBe("0 dB");
});

it("half scale reads −6 dB on a 90% fill", () => {
  expect(meterPercent(0.5)).toBeCloseTo(((-6.0206 + 60) / 60) * 100, 6);
  expect(meterDbLabel(0.5)).toBe("-6 dB");
});

it("the meter floor is shared by the fill and the readout", () => {
  expect(meterPercent(METER_FLOOR_LINEAR)).toBe(0);
  expect(meterDbLabel(METER_FLOOR_LINEAR)).toBe(`${METER_FLOOR_DB} dB`);
});

it("a decaying tail never prints a runaway dB value", () => {
  // The bug: a peak-hold that decays for a few seconds reached ≈1e-150, so the
  // readout said "-3000 dB" while the fill was already empty.
  expect(meterPercent(1e-150)).toBe(0);
  expect(meterDbLabel(1e-150)).toBe("< -60 dB");
});

it("non-finite amplitudes fall back to silence", () => {
  expect(meterPercent(Number.NaN)).toBe(0);
  expect(meterDbLabel(Number.NaN)).toBe("—");
  expect(meterPercent(Number.POSITIVE_INFINITY)).toBe(0);
  expect(meterDbLabel(Number.POSITIVE_INFINITY)).toBe("—");
});

it('levels just under 0 dBFS do not render as "-0 dB"', () => {
  expect(meterDbLabel(0.99)).toBe("0 dB");
});
