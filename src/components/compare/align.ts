/**
 * Aligning two results for an overlay chart (M25).
 *
 * The core computes the delta on matched frames, but a chart needs **one x axis**. Two
 * sides with the same grid may still have different frame counts and window starts, so
 * the columns are merged onto a union of their frame times and each value is matched
 * to its nearest time within a tolerance (`0.6 × hop`) — never by index. When the grid
 * differs the view does not overlay at all (two plots side by side), so this never
 * interpolates across different resolutions.
 * See `docs/comparison.md` → "The compare view".
 */

/** One merged column set over a shared time axis. */
export interface MergedSeries {
  times: number[];
  a: (number | null)[];
  b: (number | null)[];
  delta: (number | null)[];
}

/** The typical spacing of a uniform time axis (median consecutive difference). */
export function hopOf(times: readonly number[]): number {
  if (times.length < 2) return 0;
  const steps: number[] = [];
  for (let i = 1; i < times.length; i++) steps.push(times[i] - times[i - 1]);
  steps.sort((x, y) => x - y);
  return Math.max(0, steps[Math.floor(steps.length / 2)] ?? 0);
}

/** A union of two sorted time arrays, coalescing entries closer than `tol`. */
export function unionTimes(
  aTimes: readonly number[],
  bTimes: readonly number[],
  tol: number,
): number[] {
  const times: number[] = [];
  let i = 0;
  let j = 0;
  while (i < aTimes.length || j < bTimes.length) {
    const nextA = i < aTimes.length ? aTimes[i] : Number.POSITIVE_INFINITY;
    const nextB = j < bTimes.length ? bTimes[j] : Number.POSITIVE_INFINITY;
    const next = Math.min(nextA, nextB);
    const last = times[times.length - 1];
    if (last == null || next - last > tol) times.push(next);
    else times[times.length - 1] = (last + next) / 2;
    if (nextA <= nextB) i++;
    else j++;
  }
  return times;
}

/** Each target time's nearest value from a sorted column, within `tol`. */
export function nearestColumn(
  times: readonly number[],
  values: readonly (number | null)[],
  targets: readonly number[],
  tol: number,
): (number | null)[] {
  const out: (number | null)[] = [];
  let cursor = 0;
  for (const target of targets) {
    if (times.length === 0) {
      out.push(null);
      continue;
    }
    while (
      cursor + 1 < times.length &&
      Math.abs(times[cursor + 1] - target) <= Math.abs(times[cursor] - target)
    ) {
      cursor++;
    }
    out.push(Math.abs(times[cursor] - target) <= tol ? (values[cursor] ?? null) : null);
  }
  return out;
}

/**
 * Merge two series (and the core's delta, which is keyed on A's frames) onto one axis.
 * `tol` defaults to 0.6 × the coarser hop.
 */
export function mergeSeries(
  aTimes: readonly number[],
  aValues: readonly (number | null)[],
  bTimes: readonly number[],
  bValues: readonly (number | null)[],
  deltaTimes: readonly number[] = [],
  deltaValues: readonly (number | null)[] = [],
  tol = Math.max(hopOf(aTimes), hopOf(bTimes)) * 0.6 || 1e-4,
): MergedSeries {
  const times = unionTimes(aTimes, bTimes, tol / 2);
  return {
    times,
    a: nearestColumn(aTimes, aValues, times, tol),
    b: nearestColumn(bTimes, bValues, times, tol),
    delta:
      deltaTimes.length > 0
        ? nearestColumn(deltaTimes, deltaValues, times, tol)
        : times.map(() => null),
  };
}

/** Map a time-axis overlay back to [x, ...columns] for uPlot. */
export function toUplotData(
  merged: MergedSeries,
): [number[], (number | null)[], (number | null)[], (number | null)[]] {
  return [merged.times, merged.a, merged.b, merged.delta];
}
