import { For } from "solid-js";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";

/**
 * Cursor tooltip for analyzer charts. Reads the value of each visible y-series at
 * the cursor index and formats it with the tool's formatters.
 *
 * A chart may put a second track on its own right-hand scale (a confidence or phon
 * axis). `formatScale` names that scale's formatter, and `hideScales` (default `["y2"]`)
 * hides the secondary reference overlays that are not comparable to the primary axis.
 *
 * `seriesValue` is called *inside* the JSX expression, so Solid re-runs it when the
 * cursor index changes. (Reading the value eagerly in `For`'s callback body would
 * capture the first index and go stale.)
 */
export default function ChartTooltip(
  props: TooltipProps & {
    xLabel: string;
    formatX: (value: number) => string;
    formatY: (value: number) => string;
    /** Per-scale formatters, keyed by uPlot scale (`y2` for the right-hand track). */
    formatScale?: Record<string, (value: number) => string>;
    /** Scales whose series are not shown (a reference curve, a different unit). */
    hideScales?: string[];
  },
) {
  const hidden = (scale: string | undefined) => (props.hideScales ?? ["y2"]).includes(scale ?? "y");

  const seriesValue = (seriesIdx: number, scale: string | undefined): string => {
    const value = props.u.data[seriesIdx]?.[props.cursor.idx];
    if (typeof value !== "number") return "–";
    const format = scale ? props.formatScale?.[scale] : undefined;
    return (format ?? props.formatY)(value);
  };

  return (
    <div class="chart-tooltip">
      <div class="chart-tooltip-x">
        {props.xLabel} {props.formatX(props.cursor.xValue)}
      </div>
      <For each={props.seriesData.filter((series) => !hidden(series.scale))}>
        {(series) => (
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-label">{series.label}</span>
            <span class="chart-tooltip-value">{seriesValue(series.seriesIdx, series.scale)}</span>
          </div>
        )}
      </For>
    </div>
  );
}
