/**
 * Waveform peak helpers for the Timeline.
 *
 * Rendering millions of samples per frame is wasteful, so a base-resolution
 * min/max envelope is computed once per source. When the viewport is zoomed in
 * past the envelope's resolution, the renderer falls back to raw samples for
 * full detail.
 */

export interface Peaks {
  /** Frames covered by each bucket. */
  step: number;
  min: Float32Array;
  max: Float32Array;
  frames: number;
  channels: number;
}

/** Build a mono-mixed min/max envelope targeting `targetBuckets` buckets. */
export function computePeaks(
  samples: Float32Array,
  frames: number,
  channels: number,
  targetBuckets = 8192,
): Peaks {
  const step = Math.max(1, Math.floor(frames / targetBuckets));
  const buckets = Math.max(1, Math.ceil(frames / step));
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const inv = 1 / channels;

  for (let b = 0; b < buckets; b++) {
    const f0 = b * step;
    const f1 = Math.min(frames, f0 + step);
    let lo = 1;
    let hi = -1;
    for (let f = f0; f < f1; f++) {
      let sum = 0;
      const base = f * channels;
      for (let c = 0; c < channels; c++) sum += samples[base + c];
      const v = sum * inv;
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
 * Min/max of the mono mix over the half-open frame range `[f0, f1)`, using the
 * envelope when it is fine enough, otherwise the raw samples.
 */
export function columnExtent(
  peaks: Peaks | null,
  samples: Float32Array,
  frames: number,
  channels: number,
  f0: number,
  f1: number,
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
    const inv = 1 / channels;
    for (let f = s0; f < s1; f++) {
      let sum = 0;
      const base = f * channels;
      for (let c = 0; c < channels; c++) sum += samples[base + c];
      const v = sum * inv;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  if (lo > hi) return [0, 0];
  return [lo, hi];
}
