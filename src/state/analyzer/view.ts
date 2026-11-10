import type { SeriesView } from "./types";

/**
 * Build a `series` view from its label and y-formatter, plus any overrides.
 *
 * `options` carries the whole optional descriptor surface — the sampling model, what a
 * bounded scale means, the supporting tool the track is derived from, the fill — so a
 * tool declares its chart semantics as **data** and the chart picks its paths from them
 * (M36). There is no per-tool condition on an id anywhere in `TimeSeriesChart`.
 */
export function series(
  yLabel: string,
  formatY: (value: number) => string,
  options: Partial<Omit<SeriesView, "kind" | "yLabel" | "formatY">> = {},
): SeriesView {
  return { kind: "series", yLabel, formatY, ...options };
}
