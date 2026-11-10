/**
 * Percentile helpers for distribution readouts (M27 loudness, M36).
 *
 * N5 / N50 / N95 are order statistics of one track, so they are defined once here
 * instead of each view re-sorting the array its own way. The convention matches the
 * loudness literature: **N5 is the level exceeded 5% of the time** — the 95th
 * percentile of the ascending distribution — and N95 is the level exceeded 95% of
 * the time (the 5th percentile).
 */

/** The finite, non-gap values of a track. */
export function present(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value));
}

/**
 * The linearly interpolated percentile `p` (0…1) of a sample: the value at rank
 * `p · (n − 1)` in ascending order, blended between its two neighbours. An empty
 * sample is 0 (the caller decides whether to render that at all).
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = Math.min(1, Math.max(0, p)) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** The arithmetic mean of a sample (0 for an empty one). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
