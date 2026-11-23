import type { CompareSideDto, ComparisonDto, Span } from "../../state/compare/types";
import type { AxisTransform } from "../../state/chartSync";

/**
 * The **relative** display transform every compare chart shares (M25.B; M23 Phase 3 drops
 * the display swap and keeps the fine-tune δ).
 *
 * The core matches on an *owner* axis (A at 0, the reference shifted by δ); this maps
 * each side's absolute source seconds onto the display axis:
 *
 * - A is anchored at 0 at **its own** window start;
 * - B is anchored at 0 too and shifted by δ;
 * - a core delta time is already in owner coordinates, i.e. on the display axis.
 *
 */

export interface CompareTime {
  /** The x-axis extent: A's window length (the longer side is clipped to it). */
  extent: () => number;
  /** Displayed A's source-second origin (its result's window start). */
  originA: () => number;
  /** Displayed B's origin. */
  originB: () => number;
  /** B's display shift (the fine-tune δ). */
  shiftB: () => number;
  /** Source second → display x for A. */
  a: (secs: number) => number;
  /** Source second → display x for B. */
  b: (secs: number) => number;
  /** B's analysis window as a band on the display axis. */
  bWindow: () => Span | null;
  /** Whether the common span clips A. */
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

export function compareTime(comparison: () => ComparisonDto): CompareTime {
  const alignment = () => comparison().comparability.alignment;
  const originA = () => resultOrigin(comparison().a);
  const originB = () => resultOrigin(comparison().b);
  const extent = () => alignment().aDuration;
  const shiftB = () => alignment().bOffset;
  const toSource = (x: number) => x + originA();
  const fromSource = (x: number) => x - originA();

  return {
    extent,
    originA,
    originB,
    shiftB,
    a: (secs) => secs - originA(),
    b: (secs) => secs - originB() + shiftB(),
    toSource,
    fromSource,
    axis: () => ({ toBus: toSource, fromBus: fromSource }),
    bWindow: () => {
      const start = shiftB();
      return { start, end: start + alignment().bDuration };
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
 * Drop the points past `end` from a time series, so B ends where its data (or A's
 * extent) ends instead of stretching the axis.
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
