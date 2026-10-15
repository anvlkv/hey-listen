import { SPEED_MAX, SPEED_MIN, positionToSpeed, speedToPosition } from "../src/lib/previewSpeed";
import { assertEqual, check, report } from "./testHarness";

/**
 * Unit checks for the preview **varispeed** slider's log scale (`src/lib/previewSpeed.ts`)
 * — the mapping between the slider position (−1…1) and the playback rate the transport
 * shows and the core plays. See `docs/notes.md` → Preview playback.
 */

/** Compare to 6 decimals, so a float round-trip can use `assertEqual`. */
const round = (value: number) => Number(value.toFixed(6));

check("puts 1× exactly at the centre of the slider", () => {
  assertEqual(positionToSpeed(0), 1);
  assertEqual(speedToPosition(1), 0);
});

check("maps the ends of the track to the supported range", () => {
  assertEqual(positionToSpeed(-1), SPEED_MIN);
  assertEqual(positionToSpeed(1), SPEED_MAX);
  assertEqual(speedToPosition(SPEED_MIN), -1);
  assertEqual(speedToPosition(SPEED_MAX), 1);
  // Half-way out is half-way in speed, because the scale is logarithmic.
  assertEqual(positionToSpeed(0.5), 2);
  assertEqual(positionToSpeed(-0.5), 0.5);
});

check("round-trips a slider position through a speed", () => {
  for (const position of [-1, -0.75, -0.25, 0, 0.25, 0.75, 1]) {
    assertEqual(round(speedToPosition(positionToSpeed(position))), position);
  }
});

check("clamps out-of-range input and treats a non-number as 1×", () => {
  assertEqual(speedToPosition(100), 1);
  assertEqual(speedToPosition(0.001), -1);
  assertEqual(positionToSpeed(5), SPEED_MAX);
  assertEqual(positionToSpeed(-5), SPEED_MIN);
  assertEqual(speedToPosition(Number.NaN), 0);
  // A non-number *position* falls back to the centre, i.e. 1×.
  assertEqual(positionToSpeed(Number.NaN), 1);
});

report("previewSpeed");
