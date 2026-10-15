import type { SeriesView } from "./types";

/** Build a `series` view from its label and y-formatter, plus any overrides. */
export function series(
  yLabel: string,
  formatY: (value: number) => string,
  options: Partial<Omit<SeriesView, "kind" | "yLabel" | "formatY">> = {},
): SeriesView {
  return { kind: "series", yLabel, formatY, ...options };
}
