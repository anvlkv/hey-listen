import { percentile } from "../../lib/percentiles";
import type { PitchResult, SpectrogramResult } from "../../state/analyzer";
import type { PitchOverlay } from "./spectrogramRender";

/**
 * Compose a [`PitchOverlay`](./spectrogramRender.ts) for a spectrogram from a
 * **separately computed** `PitchResult` of the same window (M36).
 *
 * The heatmap's frames and the pitch grid are independent sampling grids, so the F0
 * track is resampled onto the heatmap's frame centres (the same time formula
 * `drawContours` uses) with `NaN` on every unvoiced frame — the track is never
 * inferred from the centroid or rolloff, and a gap stays a gap.
 *
 * The harmonic rules are the multiples of the **median** voiced F0 (the phase-2
 * payload has no per-frame candidate set), labelled as such in the legend.
 */

/** The highest harmonic multiple drawn (keeps the rules readable). */
const MAX_HARMONIC = 10;
/** Below this many voiced frames a "median f0" is not a pitch (M21.B's convention). */
const MIN_VOICED_FRAMES = 3;

export function composePitchOverlay(
  pitch: PitchResult | null,
  result: SpectrogramResult | null,
): PitchOverlay | null {
  if (!pitch || !result) return null;
  const frames = result.frames;
  const pitchTimes = pitch.times;
  if (frames === 0 || pitchTimes.length === 0) return null;
  if (pitchTimes.length !== pitch.values.length) return null;

  const f0 = new Float64Array(frames);
  f0.fill(Number.NaN);
  const duration = Math.max(result.duration, 1e-9);
  const voiced: number[] = [];
  // Both grids ascend, so one forward pass finds each heatmap frame's nearest pitch
  // frame (no search per frame).
  let cursor = 0;
  for (let frame = 0; frame < frames; frame++) {
    const at = result.windowStart + ((frame + 0.5) / frames) * duration;
    while (
      cursor + 1 < pitchTimes.length &&
      Math.abs(pitchTimes[cursor + 1] - at) <= Math.abs(pitchTimes[cursor] - at)
    ) {
      cursor++;
    }
    const value = pitch.values[cursor];
    if (value != null && Number.isFinite(value)) {
      f0[frame] = value;
      voiced.push(value);
    }
  }

  if (voiced.length < MIN_VOICED_FRAMES) return { f0, harmonics: [] };
  const median = percentile(voiced, 0.5);
  const topHz = result.freqs[result.bins - 1] ?? Number.POSITIVE_INFINITY;
  const harmonics: number[] = [];
  for (let multiple = 2; multiple <= MAX_HARMONIC; multiple++) {
    const hz = median * multiple;
    if (!(hz < topHz)) break;
    harmonics.push(hz);
  }
  return { f0, harmonics };
}
