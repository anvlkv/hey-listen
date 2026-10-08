/**
 * Waveform peak helpers for the Timeline.
 *
 * Rendering millions of samples per frame is wasteful, so a base-resolution
 * min/max envelope is computed once per source. When the viewport is zoomed in
 * past the envelope's resolution, the renderer falls back to raw samples for
 * full detail.
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

export interface Peaks {
  /** Frames covered by each bucket. */
  step: number;
  min: ArrayLike<number>;
  max: ArrayLike<number>;
  frames: number;
  channels: number;
}

/** Build a min/max envelope targeting `targetBuckets` buckets. */
export function computePeaks(
  samples: Float32Array,
  frames: number,
  channels: number,
  pick: ChannelPick = "mix",
  targetBuckets = 8192,
): Peaks {
  const step = Math.max(1, Math.floor(frames / targetBuckets));
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
    if (lo > hi) {
      lo = 0;
      hi = 0;
    }
    min[b] = lo;
    max[b] = hi;
  }

  return { step, min, max, frames, channels };
}

/**
 * Min/max of the picked channel (or the mono mix) over the half-open frame range
 * `[f0, f1)`, using the envelope when it is fine enough, otherwise the raw
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

  let lo = 1;
  let hi = -1;

  if (peaks && s1 - s0 >= peaks.step * 2) {
    const b0 = Math.max(0, Math.floor(s0 / peaks.step));
    const b1 = Math.min(peaks.min.length, Math.ceil(s1 / peaks.step));
    for (let b = b0; b < b1; b++) {
      if (peaks.min[b] < lo) lo = peaks.min[b];
      if (peaks.max[b] > hi) hi = peaks.max[b];
    }
  } else {
    const mixed = pick === "mix";
    const inv = 1 / channels;
    const offset = channelOffset(pick, channels);
    for (let f = s0; f < s1; f++) {
      const v = readFrame(samples, f * channels, channels, mixed, offset, inv);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
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
 * Built for one `pick`; when the channel selection changes, rebuild it and
 * replay the samples so far.
 */
export class PeakAccumulator {
  readonly step: number;
  readonly channels: number;
  readonly pick: ChannelPick;
  readonly min: number[] = [1];
  readonly max: number[] = [-1];
  frames = 0;

  private curMin = 1;
  private curMax = -1;
  private curFill = 0;
  private readonly mixed: boolean;
  private readonly offset: number;
  private readonly inv: number;

  constructor(channels: number, pick: ChannelPick = "mix", step = 512) {
    this.channels = channels;
    this.pick = pick;
    this.step = step;
    this.mixed = pick === "mix";
    this.offset = channelOffset(pick, channels);
    this.inv = 1 / channels;
  }

  /** Append interleaved `f32` samples (a whole number of frames). */
  push(interleaved: Float32Array) {
    const { channels, step, mixed, offset, inv } = this;
    const count = Math.floor(interleaved.length / channels);
    let i = 0;

    while (i < count) {
      const take = Math.min(step - this.curFill, count - i);
      for (let k = 0; k < take; k++) {
        const v = readFrame(interleaved, (i + k) * channels, channels, mixed, offset, inv);
        if (v < this.curMin) this.curMin = v;
        if (v > this.curMax) this.curMax = v;
      }
      i += take;
      this.curFill += take;
      this.frames += take;

      // The last element always holds the (possibly partial) current bucket.
      this.min[this.min.length - 1] = this.curMin;
      this.max[this.max.length - 1] = this.curMax;

      if (this.curFill === step) {
        this.curMin = 1;
        this.curMax = -1;
        this.curFill = 0;
        this.min.push(1);
        this.max.push(-1);
      }
    }
  }

  /** A [`Peaks`] view over the buckets accumulated so far (live arrays). */
  view(): Peaks {
    return {
      step: this.step,
      min: this.min,
      max: this.max,
      frames: this.frames,
      channels: this.channels,
    };
  }
}
