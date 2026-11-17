import type { CompareLiveHandle } from "../../state/compare/live";
import type { CompareSideDto, ComparisonDto, LiveSideDto } from "../../state/compare/types";
import type { CompareTime } from "./time";

/**
 * The two sides of a comparison.
 *
 * Every compare view needs the same accessors: A and B, their typed results, and whether
 * the core found a delta. They take accessors (not values) so the view can read them
 * inside tracked scopes.
 */
export interface CompareSides<R> {
  a: () => CompareSideDto;
  b: () => CompareSideDto;
  resultA: () => R | undefined;
  resultB: () => R | undefined;
  aligned: () => boolean;
}

export function compareSides<R>(comparison: () => ComparisonDto): CompareSides<R> {
  const a = () => comparison().a;
  const b = () => comparison().b;
  return {
    a,
    b,
    resultA: () => a().result as R | undefined,
    resultB: () => b().result as R | undefined,
    aligned: () => comparison().comparability.aligned,
  };
}

/**
 * The compare marker plugin's accessors: the A/B live state, the reference's window band,
 * and the axis B's read-only cursor belongs to.
 *
 * On a **time** chart the live source seconds are moved onto the relative display axis
 * (M25.B) — a source second means nothing on an axis that starts at each side's own
 * window — while frequency / rate cursors pass through unchanged. Shared by every uPlot
 * compare chart.
 */
export function liveMarkers(options: {
  live: CompareLiveHandle;
  time: CompareTime;
  axis: "time" | "freq" | "rate";
}) {
  const mapped = (side: LiveSideDto, map: (secs: number) => number): LiveSideDto => ({
    ...side,
    playhead: side.playhead == null ? null : map(side.playhead),
    cursorTime: side.cursorTime == null ? null : map(side.cursorTime),
  });
  const sideA = () => {
    const side = options.live.a();
    return options.axis === "time" ? mapped(side, options.time.a) : side;
  };
  const sideB = () => {
    const side = options.live.b();
    return options.axis === "time" ? mapped(side, options.time.b) : side;
  };
  return {
    a: sideA,
    b: sideB,
    window: () => (options.axis === "time" ? options.time.bWindow() : null),
    axis: options.axis,
  };
}
