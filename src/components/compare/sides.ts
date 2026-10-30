import type { CompareLiveHandle } from "../../state/compare/live";
import type { CompareSideDto, ComparisonDto } from "../../state/compare/types";

/**
 * The two sides of a comparison, following the header's **Swap A/B**.
 *
 * Every compare view needs the same four accessors: the displayed A and B sides, their
 * typed results, and whether the core found a delta. Passing `swapped` as an accessor
 * (not a value) keeps a swap from remounting the chart.
 */
export interface CompareSides<R> {
  a: () => CompareSideDto;
  b: () => CompareSideDto;
  resultA: () => R | undefined;
  resultB: () => R | undefined;
  aligned: () => boolean;
}

export function compareSides<R>(
  comparison: () => ComparisonDto,
  swapped: () => boolean,
): CompareSides<R> {
  const a = () => (swapped() ? comparison().b : comparison().a);
  const b = () => (swapped() ? comparison().a : comparison().b);
  return {
    a,
    b,
    resultA: () => a().result as R | undefined,
    resultB: () => b().result as R | undefined,
    aligned: () => comparison().comparability.aligned,
  };
}

/**
 * The compare marker plugin's accessors: the displayed A/B live state, the reference's
 * window band, and the axis B's read-only cursor belongs to. Shared by every uPlot
 * compare chart so a swap never leaves a marker labelled B on the A series' project.
 */
export function liveMarkers(options: {
  live: CompareLiveHandle;
  swapped: () => boolean;
  window: () => { start: number; end: number } | null;
  axis: "time" | "freq" | "rate";
}) {
  return {
    a: () => (options.swapped() ? options.live.b() : options.live.a()),
    b: () => (options.swapped() ? options.live.a() : options.live.b()),
    window: options.window,
    axis: options.axis,
  };
}
