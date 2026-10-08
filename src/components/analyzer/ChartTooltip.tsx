import { For } from "solid-js";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";

/**
 * Cursor tooltip for analyzer charts. Reads the value of each visible y-series at
 * the cursor index and formats it with the tool's formatters.
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
  },
) {
  const seriesValue = (seriesIdx: number): string => {
    const value = props.u.data[seriesIdx]?.[props.cursor.idx];
    return typeof value === "number" ? props.formatY(value) : "–";
  };

  return (
    <div class="chart-tooltip">
      <div class="chart-tooltip-x">
        {props.xLabel} {props.formatX(props.cursor.xValue)}
      </div>
      <For each={props.seriesData}>
        {(series) => (
          <div class="chart-tooltip-row">
            <span class="chart-tooltip-label">{series.label}</span>
            <span class="chart-tooltip-value">{seriesValue(series.seriesIdx)}</span>
          </div>
        )}
      </For>
    </div>
  );
}
