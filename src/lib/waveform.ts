/**
 * Waveform peak helpers for the Timeline.
 *
 * Rendering millions of samples per frame is wasteful, so a **pyramid** of min/max
 * envelopes is computed once per source: a fine level for deep zooms, then coarser
 * levels up to the full view. When the viewport gets too deep for even the finest
 * level, the renderer falls back to raw samples for full detail.
 *
 * The pyramid is what keeps a repaint cheap at *every* zoom. A single base envelope
 * left a gap: for a column that spans less than ~2 buckets, the renderer read raw
 * samples, so a zoomed-in 4-minute recording scanned millions of samples on each
 * repaint — and the Timeline repaints on every chart cursor move and transport tick.
 *
 * Both paths can read either a **downmix** of all channels or a **single
 * channel** (see `ChannelPick`) — that is what the Timeline's channel selector
 * drives, and what analysis will use too.
 */

/** `"mix"` downmixes all channels to mono; a number selects a 0-based channel. */
export type ChannelPick = "mix" | number;

/** The sample offset (add to a frame's base index) for a pick. */
function channelOffset(pick: ChannelPick, channels: number): number {
  if (pick === "mix") return 0;
  return Math.min(Math.max(Math.trunc(pick), 0), channels - 1);
}

/** Read one frame's mono value from interleaved samples. */
function readFrame(
  samples: ArrayLike<number>,
  base: number,
  channels: number,
  mixed: boolean,
  offset: number,
  inv: number,
): number {
  if (!mixed) return samples[base + offset];
  let sum = 0;
  for (let c = 0; c < channels; c++) sum += samples[base + c];
  return sum * inv;
}

export interface PeakLevel {
  /** Frames covered by each bucket. */
  step: number;
  min: ArrayLike<number>;
  max: ArrayLike<number>;
}

export interface Peaks extends PeakLevel {
  frames: number;
  channels: number;
  /**
   * Every envelope for this source, **coarsest first** (the base level is `levels[0]`
   * and the base fields above mirror it). [`columnExtent`] takes the coarsest level
   * that still resolves one column, so repaint work stays bounded at any zoom.
   */
  levels: PeakLevel[];
}

/** Buckets in the finest envelope; ~260k resolves a few frames per pixel. */
const FINE_BUCKETS = 262_144;
/** Each coarser level merges this many finer buckets. */
const LEVEL_FACTOR = 4;

/** Build one envelope at `step` frames per bucket. */
function buildLevel(
  samples: Float32Array,
  frames: number,
  channels: number,
  pick: ChannelPick,
  step: number,
): PeakLevel {
  const buckets = Math.max(1, Math.ceil(frames / step));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const mixed = pick === "mix";
  const inv = 1 / channels;
  const offset = channelOffset(pick, channels);

  for (let b = 0; b < buckets; b++) {
    const f0 = b * step;
    const f1 = Math.min(frames, f0 + step);
    let lo = 1;
    let hi = -1;
    for (let f = f0; f < f1; f++) {
      const v = readFrame(samples, f * channels, channels, mixed, offset, inv);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo > hi ? 0 : lo;
    max[b] = lo > hi ? 0 : hi;
  }

  return { step, min, max };
}

/** Merge `LEVEL_FACTOR` buckets of `fine` into the next coarser level. */
function coarsen(fine: PeakLevel): PeakLevel {
  const step = fine.step * LEVEL_FACTOR;
  const buckets = Math.max(1, Math.ceil(fine.min.length / LEVEL_FACTOR));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);

  for (let b = 0; b < buckets; b++) {
    const b0 = b * LEVEL_FACTOR;
    const b1 = Math.min(fine.min.length, b0 + LEVEL_FACTOR);
    let lo = 1;
    let hi = -1;
    for (let i = b0; i < b1; i++) {
      if (fine.min[i] < lo) lo = fine.min[i];
      if (fine.max[i] > hi) hi = fine.max[i];
    }
    min[b] = lo > hi ? 0 : lo;
    max[b] = lo > hi ? 0 : hi;
  }

  return { step, min, max };
}

/** Build the level pyramid (coarsest first) from one pass over the samples. */
function buildLevels(
  samples: Float32Array,
  frames: number,
  channels: number,
  pick: ChannelPick,
  targetBuckets: number,
): PeakLevel[] {
  if (frames <= 0) {
    return [{ step: 1, min: new Float32Array(1), max: new Float32Array(1) }];
  }
  const fineStep = Math.max(1, Math.floor(frames / FINE_BUCKETS));
  const levels: PeakLevel[] = [buildLevel(samples, frames, channels, pick, fineStep)];
  while (levels[levels.length - 1].min.length > targetBuckets) {
    levels.push(coarsen(levels[levels.length - 1]));
  }
  return levels.reverse();
}

/** Build a min/max envelope pyramid targeting `targetBuckets` buckets at full view. */
export function computePeaks(
  samples: Float32Array,
  frames: number,
  channels: number,
  pick: ChannelPick = "mix",
  targetBuckets = 8192,
): Peaks {
  const levels = buildLevels(samples, frames, channels, pick, targetBuckets);
  const base = levels[0];
  return { ...base, frames, channels, levels };
}

/**
 * The coarsest level that resolves one column with at least two buckets (`step * 2 <=
 * span`, the fidelity the single-envelope renderer always had), or `null` when even the
 * finest one cannot — then the caller reads raw samples.
 */
function levelFor(peaks: Peaks, span: number): PeakLevel | null {
  for (const level of peaks.levels) {
    if (level.step * 2 <= span) return level;
  }
  return null;
}

/**
 * Min/max of the picked channel (or the mono mix) over the half-open frame range
 * `[f0, f1)`, using the coarsest envelope that resolves one column, otherwise raw
 * samples.
 */
export function columnExtent(
  peaks: Peaks | null,
  samples: Float32Array,
  frames: number,
  channels: number,
  f0: number,
  f1: number,
  pick: ChannelPick = "mix",
): [number, number] {
  const s0 = Math.max(0, Math.floor(f0));
  const s1 = Math.min(frames, Math.ceil(f1));
  if (s1 <= s0) return [0, 0];

  const level = peaks ? levelFor(peaks, s1 - s0) : null;
  if (level) {
    const b0 = Math.max(0, Math.floor(s0 / level.step));
    const b1 = Math.min(level.min.length, Math.ceil(s1 / level.step));
    let lo = 1;
    let hi = -1;
    for (let b = b0; b < b1; b++) {
      if (level.min[b] < lo) lo = level.min[b];
      if (level.max[b] > hi) hi = level.max[b];
    }
    if (lo <= hi) return [lo, hi];
  }

  const mixed = pick === "mix";
  const inv = 1 / channels;
  const offset = channelOffset(pick, channels);
  let lo = 1;
  let hi = -1;
  for (let f = s0; f < s1; f++) {
    const v = readFrame(samples, f * channels, channels, mixed, offset, inv);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  if (lo > hi) return [0, 0];
  return [lo, hi];
}

/**
 * Incremental min/max envelope for a **growing** source (live capture).
 *
 * The whole buffer is never re-scanned: each chunk updates the trailing bucket
 * in place and appends a new one when it fills, so publishing peaks is O(chunk)
 * regardless of recording length. Exposed as a [`Peaks`] view whose `min`/`max`
 * arrays are the live ones (mutated as audio arrives).
 *
 * Two levels are maintained in one pass — the base `step` and a `fineStep` one, which
 * is what keeps a zoomed-in capture cheap to draw (see [`columnExtent`]).
 *
 * Built for one `pick`; when the channel selection changes, rebuild it and
 * replay the samples so far.
 */
export class PeakAccumulator {
  readonly step: number;
  /** The finer level's step (`step / 8`, at least 1). */
  readonly fineStep: number;
  readonly channels: number;
  readonly pick: ChannelPick;
  readonly min: number[] = [1];
  readonly max: number[] = [-1];
  frames = 0;

  private readonly fineMin: number[] = [1];
  private readonly fineMax: number[] = [-1];
  private curMin = 1;
  private curMax = -1;
  private curFill = 0;
  private fineCurMin = 1;
  private fineCurMax = -1;
  private fineFill = 0;
  private readonly mixed: boolean;
  private readonly offset: number;
  private readonly inv: number;

  constructor(channels: number, pick: ChannelPick = "mix", step = 512) {
    this.channels = channels;
    this.pick = pick;
    this.step = step;
    this.fineStep = Math.max(1, Math.floor(step / 8));
    this.mixed = pick === "mix";
    this.offset = channelOffset(pick, channels);
    this.inv = 1 / channels;
  }

  /** Append interleaved `f32` samples (a whole number of frames). */
  push(interleaved: Float32Array) {
    const { channels, step, fineStep, mixed, offset, inv } = this;
    const count = Math.floor(interleaved.length / channels);

    for (let i = 0; i < count; i++) {
      const v = readFrame(interleaved, i * channels, channels, mixed, offset, inv);

      if (v < this.fineCurMin) this.fineCurMin = v;
      if (v > this.fineCurMax) this.fineCurMax = v;
      this.fineFill += 1;
      if (this.fineFill === fineStep) {
        this.writeFine();
        this.fineCurMin = 1;
        this.fineCurMax = -1;
        this.fineFill = 0;
        this.fineMin.push(1);
        this.fineMax.push(-1);
      }

      if (v < this.curMin) this.curMin = v;
      if (v > this.curMax) this.curMax = v;
      this.curFill += 1;
      if (this.curFill === step) {
        this.min[this.min.length - 1] = this.curMin;
        this.max[this.max.length - 1] = this.curMax;
        this.curMin = 1;
        this.curMax = -1;
        this.curFill = 0;
        this.min.push(1);
        this.max.push(-1);
      }
    }

    this.frames += count;
    // The last element always holds the (possibly partial) current bucket of each
    // level, so a view published now shows what has arrived so far.
    this.min[this.min.length - 1] = this.curMin;
    this.max[this.max.length - 1] = this.curMax;
    this.writeFine();
  }

  /** Keep the fine level's trailing bucket current. */
  private writeFine() {
    this.fineMin[this.fineMin.length - 1] = this.fineCurMin;
    this.fineMax[this.fineMax.length - 1] = this.fineCurMax;
  }

  /** A [`Peaks`] view over the buckets accumulated so far (live arrays). */
  view(): Peaks {
    const base: PeakLevel = { step: this.step, min: this.min, max: this.max };
    const levels: PeakLevel[] = [base];
    if (this.fineStep < this.step) {
      levels.push({ step: this.fineStep, min: this.fineMin, max: this.fineMax });
    }
    return {
      ...base,
      frames: this.frames,
      channels: this.channels,
      levels,
    };
  }
}
