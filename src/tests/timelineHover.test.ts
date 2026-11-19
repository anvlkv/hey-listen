import { expect, it } from "vitest";
import { formatHoverTime, formatSampleIndex } from "../components/timeline/hover";

/**
 * Unit checks for the Timeline's **hover readout** (D-01): the two pure formatters behind the
 * crosshair chip. The painting itself needs a canvas, so it stays an E2E/screenshot concern.
 *
 * ```sh
 * npm run test:unit
 * ```
 */

it("formats the hovered time as m:ss.mmm", () => {
  expect(formatHoverTime(0)).toBe("0:00.000");
  expect(formatHoverTime(1.234)).toBe("0:01.234");
  expect(formatHoverTime(61.5)).toBe("1:01.500");
  // Rounded to whole milliseconds first, so the seconds field never reads 60.
  expect(formatHoverTime(59.9999)).toBe("1:00.000");
  expect(formatHoverTime(3599.9996)).toBe("60:00.000");
});

it("clamps a negative hovered time to zero and marks a non-finite one", () => {
  expect(formatHoverTime(-2)).toBe("0:00.000");
  expect(formatHoverTime(Number.NaN)).toBe("—");
  expect(formatHoverTime(Number.POSITIVE_INFINITY)).toBe("—");
});

it("formats the hovered sample index, rounded and grouped", () => {
  expect(formatSampleIndex(0, 48_000)).toBe("0");
  expect(formatSampleIndex(1.5, 48_000)).toBe("72,000");
  expect(formatSampleIndex(0.00002, 48_000)).toBe("1");
  expect(formatSampleIndex(0.00001, 48_000)).toBe("0");
});
