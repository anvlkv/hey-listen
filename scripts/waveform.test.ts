import {
  columnExtent,
  computePeaks,
  PeakAccumulator,
  type ChannelPick,
  type Peaks,
  type PeakLevel,
} from "../src/lib/waveform";
import { assertEqual, check, report } from "./testHarness";

/**
 * Unit checks for the Timeline's waveform envelopes (`src/lib/waveform.ts`), runnable
 * without a browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * Covers the multi-resolution pyramid: the levels must remain a *faithful* envelope at
 * every zoom (a column's extent contains every sample it covers), the renderer must pick
 * a level rather than raw samples down to the deepest zoom it can, and the incremental
 * accumulator used by live capture must agree with a one-shot computation. The pyramid is
 * what keeps a zoomed-in 4-minute recording cheap to repaint (see the module docs).
 */

const CHANNELS = 2;
const FRAMES = 40_000;

/** A deterministic stereo signal: a sine on the left, its inverse on the right. */
function stereo(): Float32Array {
  const samples = new Float32Array(FRAMES * CHANNELS);
  for (let f = 0; f < FRAMES; f++) {
    const value = Math.sin(f / 37) * 0.5;
    samples[f * CHANNELS] = value;
    samples[f * CHANNELS + 1] = -value;
  }
  // A spike at one frame: +1 on the left, -1 on the right, so a single channel is
  // observable while the downmix cancels it.
  samples[100 * CHANNELS] = 1;
  samples[100 * CHANNELS + 1] = -1;
  return samples;
}

/** The exact extent of the raw samples over `[f0, f1)`, for comparison. */
function exact(samples: Float32Array, f0: number, f1: number, pick: ChannelPick = "mix") {
  let lo = 1;
  let hi = -1;
  for (let f = Math.max(0, Math.floor(f0)); f < Math.min(FRAMES, Math.ceil(f1)); f++) {
    const a = samples[f * CHANNELS];
    const b = samples[f * CHANNELS + 1];
    const v = pick === "mix" ? (a + b) / CHANNELS : pick === 0 ? a : b;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return (lo > hi ? [0, 0] : [lo, hi]) as [number, number];
}

/** Float32 envelopes vs. float64 test math: compare with a tolerance. */
function assertClose(actual: number, expected: number, message = "assertClose") {
  if (Math.abs(actual - expected) > 1e-5) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

/** The level `columnExtent` should choose for a column `span` frames wide. */
function levelFor(levels: PeakLevel[], span: number): PeakLevel | undefined {
  return levels.find((level) => level.step * 2 <= span);
}

/** A bucket-aligned level must match the raw samples in every bucket. */
function assertLevelMatchesRaw(level: PeakLevel) {
  for (let b = 0; b < level.min.length; b++) {
    const f0 = b * level.step;
    if (f0 >= FRAMES) continue; // the accumulator's trailing sentinel is empty
    const f1 = Math.min(FRAMES, f0 + level.step);
    const [lo, hi] = exact(samples, f0, f1);
    if (Math.abs(level.min[b] - lo) > 1e-6) throw new Error(`bucket ${b} min != ${lo}`);
    if (Math.abs(level.max[b] - hi) > 1e-6) throw new Error(`bucket ${b} max != ${hi}`);
  }
}

const samples = stereo();
const peaks = computePeaks(samples, FRAMES, CHANNELS, "mix");

check("a pyramid is coarse → fine and covers the whole source at every level", () => {
  if (peaks.levels.length < 2) throw new Error("expected a finer level for a 40k-frame source");
  assertEqual(peaks.levels[0].step, peaks.step);
  assertEqual(peaks.levels[0].min, peaks.min);
  for (let i = 0; i < peaks.levels.length; i++) {
    const level = peaks.levels[i];
    if (level.min.length * level.step < FRAMES)
      throw new Error("a level does not cover the source");
    if (i > 0 && level.step >= peaks.levels[i - 1].step) {
      throw new Error("levels are not ordered coarse → fine");
    }
  }
  // The base level stays at the full-view bucket budget.
  if (peaks.levels[0].min.length > 8192) throw new Error("the base level is too fine");
});

check("the full view is resolved by a coarse level, exactly", () => {
  const [lo, hi] = columnExtent(peaks, samples, FRAMES, CHANNELS, 0, FRAMES);
  const [rawLo, rawHi] = exact(samples, 0, FRAMES);
  assertClose(lo, rawLo);
  assertClose(hi, rawHi);
});

check("a zoomed-in column reads a level, and the envelope is exact at bucket scale", () => {
  const span = 4_000;
  const level = levelFor(peaks.levels, span);
  if (!level) throw new Error("expected a level for a 4k-frame column");
  const [lo, hi] = columnExtent(peaks, samples, FRAMES, CHANNELS, 5_000, 5_000 + span);
  // The chosen level aggregates whole buckets, so the result equals the exact extent of
  // the bucket-aligned span — and still contains every sample of the requested column.
  const b0 = Math.floor(5_000 / level.step) * level.step;
  const b1 = Math.min(FRAMES, Math.ceil((5_000 + span) / level.step) * level.step);
  const [wideLo, wideHi] = exact(samples, b0, b1);
  const [rawLo, rawHi] = exact(samples, 5_000, 5_000 + span);
  assertClose(lo, wideLo);
  assertClose(hi, wideHi);
  if (lo > rawLo || hi < rawHi) throw new Error("the envelope lost samples from the column");
});

check("a deep zoom falls back to exact raw samples", () => {
  // Strip the finer levels so the column is narrower than the only remaining bucket.
  const base = peaks.levels[0];
  const coarseOnly: Peaks = { ...base, frames: FRAMES, channels: CHANNELS, levels: [base] };
  const span = base.step - 1;
  if (levelFor(coarseOnly.levels, span)) throw new Error("expected no level to fit the column");
  const [lo, hi] = columnExtent(coarseOnly, samples, FRAMES, CHANNELS, 10_000, 10_000 + span);
  const [rawLo, rawHi] = exact(samples, 10_000, 10_000 + span);
  assertClose(lo, rawLo);
  assertClose(hi, rawHi);
});

check("the channel pick selects one channel or the downmix", () => {
  // The spike is +1 on the left and -1 on the right; the downmix cancels it. Each pick
  // needs its own envelope (the pyramid is built for the channel it was computed for).
  const left = computePeaks(samples, FRAMES, CHANNELS, 0);
  const right = computePeaks(samples, FRAMES, CHANNELS, 1);
  const [, leftHi] = columnExtent(left, samples, FRAMES, CHANNELS, 99, 101, 0);
  assertClose(leftHi, 1);
  const [rightLo] = columnExtent(right, samples, FRAMES, CHANNELS, 99, 101, 1);
  assertClose(rightLo, -1);
  const [mixLo, mixHi] = columnExtent(peaks, samples, FRAMES, CHANNELS, 99, 101, "mix");
  assertEqual(mixHi < 0.1, true);
  assertEqual(mixLo > -0.1, true);
});

check("the incremental accumulator matches a one-shot envelope, split arbitrarily", () => {
  const accumulator = new PeakAccumulator(CHANNELS, "mix", 512);
  // Push in awkward (whole-frame) chunk sizes so bucket boundaries fall inside a push.
  for (let offset = 0; offset < FRAMES * CHANNELS; offset += 778) {
    accumulator.push(samples.subarray(offset, Math.min(samples.length, offset + 778)));
  }
  assertEqual(accumulator.frames, FRAMES);
  const view = accumulator.view();
  assertEqual(view.frames, FRAMES);
  assertEqual(view.levels.length, 2);
  assertLevelMatchesRaw({ step: view.step, min: view.min, max: view.max });
  const fine = view.levels[view.levels.length - 1];
  assertEqual(fine.step, accumulator.fineStep);
  assertLevelMatchesRaw(fine);
});

report("waveform");
