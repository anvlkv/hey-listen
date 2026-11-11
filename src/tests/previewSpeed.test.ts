import { expect, it } from "vitest";
import { SPEED_MAX, SPEED_MIN, positionToSpeed, speedToPosition } from "../lib/previewSpeed";

/**
 * Unit checks for the preview **varispeed** slider's log scale (`src/lib/previewSpeed.ts`)
 * — the mapping between the slider position (−1…1) and the playback rate the transport
 * shows and the core plays. See `docs/annotations.md` → Preview playback.
 */

/** Compare to 6 decimals, so a float round-trip can use `toBe`. */
const round = (value: number) => Number(value.toFixed(6));

it("puts 1× exactly at the centre of the slider", () => {
  expect(positionToSpeed(0)).toBe(1);
  expect(speedToPosition(1)).toBe(0);
});

it("maps the ends of the track to the supported range", () => {
  expect(positionToSpeed(-1)).toBe(SPEED_MIN);
  expect(positionToSpeed(1)).toBe(SPEED_MAX);
  expect(speedToPosition(SPEED_MIN)).toBe(-1);
  expect(speedToPosition(SPEED_MAX)).toBe(1);
  // Half-way out is half-way in speed, because the scale is logarithmic.
  expect(positionToSpeed(0.5)).toBe(2);
  expect(positionToSpeed(-0.5)).toBe(0.5);
});

it("round-trips a slider position through a speed", () => {
  for (const position of [-1, -0.75, -0.25, 0, 0.25, 0.75, 1]) {
    expect(round(speedToPosition(positionToSpeed(position)))).toBe(position);
  }
});

it("clamps out-of-range input and treats a non-number as 1×", () => {
  expect(speedToPosition(100)).toBe(1);
  expect(speedToPosition(0.001)).toBe(-1);
  expect(positionToSpeed(5)).toBe(SPEED_MAX);
  expect(positionToSpeed(-5)).toBe(SPEED_MIN);
  expect(speedToPosition(Number.NaN)).toBe(0);
  // A non-number *position* falls back to the centre, i.e. 1×.
  expect(positionToSpeed(Number.NaN)).toBe(1);
});
