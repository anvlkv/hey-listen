import type { CompareSideDto, ComparisonDto, Span } from "../../state/compare/types";
import type { AxisTransform } from "../../state/chartSync";

/**
 * The **relative** display transform every compare chart shares (M25.B).
 *
 * The core matches on an *owner* axis (A at 0, the reference shifted by δ); this maps
 * each side's absolute source seconds onto the display axis:
 *
 * - displayed A is anchored at 0 at **its own** window start;
 * - displayed B is anchored at 0 too and shifted by δ (or −δ after **Swap A/B**, which
 *   also swaps the extents and the clipping);
 * - a core delta time (owner coordinates) moves by −δ after a swap.
 *
 * See `docs/comparison.md` → "The compare view".
 */

export interface CompareTime {
  /** Whether the display is swapped (the reference is shown as A). */
  swapped: () => boolean;
  /** The x-axis extent: the **displayed A** side's window length. */
  extent: () => number;
  /** The displayed A side's source-second origin (its result's window start). */
  originA: () => number;
  /** The displayed B side's origin. */
  originB: () => number;
  /** The displayed B side's display shift (δ, or −δ after a swap). */
  shiftB: () => number;
  /** Source second → display x for displayed A. */
  a: (secs: number) => number;
  /** Source second → display x for displayed B. */
  b: (secs: number) => number;
  /** A core (owner-coordinate) delta time → display x. */
  delta: (secs: number) => number;
  /** The displayed B side's analysis window as a band on the display axis. */
  bWindow: () => Span | null;
  /** Whether the common span clips the displayed A side. */
  clipped: () => boolean;
  /** Display x → the **owner** project's source seconds (for the sync group). */
  toSource: (x: number) => number;
  /** The owner project's source seconds → display x. */
  fromSource: (x: number) => number;
  /** The transform the shared zoom / cursor plugins convert through. */
  axis: () => AxisTransform;
}

/** The source second a side's result frame 0 refers to. */
export function resultOrigin(side: CompareSideDto): number {
  const result = side.result as { windowStart?: number } | undefined;
  return result?.windowStart ?? side.window.start;
}

export function compareTime(comparison: () => ComparisonDto, swapped: () => boolean): CompareTime {
  const alignment = () => comparison().comparability.alignment;
  const displayedA = (): CompareSideDto => (swapped() ? comparison().b : comparison().a);
  const displayedB = (): CompareSideDto => (swapped() ? comparison().a : comparison().b);
  const originA = () => resultOrigin(displayedA());
  const originB = () => resultOrigin(displayedB());
  const extent = () => (swapped() ? alignment().bDuration : alignment().aDuration);
  const shiftB = () => (swapped() ? -alignment().bOffset : alignment().bOffset);
  /** The owner's result origin and the owner→display shift (M25.B swap transform). */
  const ownerOrigin = () => resultOrigin(comparison().a);
  const deltaShift = () => (swapped() ? -alignment().bOffset : 0);
  const toSource = (x: number) => x - deltaShift() + ownerOrigin();
  const fromSource = (x: number) => x - ownerOrigin() + deltaShift();

  return {
    swapped,
    extent,
    originA,
    originB,
    shiftB,
    a: (secs) => secs - originA(),
    b: (secs) => secs - originB() + shiftB(),
    delta: (secs) => (swapped() ? secs - alignment().bOffset : secs),
    toSource,
    fromSource,
    axis: () => ({ toBus: toSource, fromBus: fromSource }),
    bWindow: () => {
      const duration = swapped() ? alignment().aDuration : alignment().bDuration;
      const start = shiftB();
      return { start, end: start + duration };
    },
    clipped: () => {
      const common = alignment().common;
      if (!common) return true;
      return common.start > 1e-6 || common.end < extent() - 1e-6;
    },
  };
}

/** One side's frame times moved onto the display axis. */
export function displayTimes(times: readonly number[], origin: number, shift = 0): number[] {
  return times.map((time) => time - origin + shift);
}

/**
 * Drop the points past `end` from a time series, so the displayed B side ends where its
 * data (or the displayed A extent) ends instead of stretching the axis.
 */
export function clipSeries(
  times: readonly number[],
  values: readonly (number | null)[],
  start: number,
  end: number,
): { times: number[]; values: (number | null)[] } {
  const keptTimes: number[] = [];
  const keptValues: (number | null)[] = [];
  for (let index = 0; index < times.length; index++) {
    const time = times[index];
    if (time < start || time > end) continue;
    keptTimes.push(time);
    keptValues.push(values[index] ?? null);
  }
  return { times: keptTimes, values: keptValues };
}
