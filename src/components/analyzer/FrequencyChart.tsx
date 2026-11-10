import { SolidUplot, type UplotPluginFactory } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { Show } from "solid-js";
import ChartLegend, { type ChartLegendEntry } from "./chartLegend";
import { type UplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { FREQ_AXIS_SPACE, X_AXIS_SIZE, Y_AXIS_SIZE, Y_AXIS_SPACE } from "./axisFormat";
import {
  chartAxisStyle,
  frequencyDbTooltip,
  frequencyRangeLabel,
  UplotChartPlot,
} from "./chartCommon";
import {
  frequencyAxisTransform,
  frequencyColumn,
  frequencyScaleAxisValues,
  frequencyScaleLabel,
  frequencyScaleXScale,
  type FrequencyScale,
} from "./frequencyScale";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { activeThemeId } from "../../state/themes";

/**
 * A reference curve drawn on its own right-hand axis. The equal-loudness contour is
 * in dB SPL while the spectrum is dBFS, so the two scales are auto-ranged
 * **independently**: a crossing of the curves is a drawing coincidence, not evidence
 * that a component is audible or at the phon contour's threshold.
 */
export interface FrequencyReference {
  /** One level per x value (the same length as the chart's x axis). */
  values: (number | null)[];
  label: string;
  stroke: string;
  dash?: number[];
}

/** Props for the shared frequency-axis chart (spectrum and its masking overlay). */
export interface FrequencyChartProps {
  zoom: UplotZoom;
  /** The columns: physical x (Hz) first, then one per y-series. */
  data: [number[], ...(number | null)[][]];
  /** The y-series (the x-series placeholder is added here). */
  series: uPlot.Series[];
  /** The dB span kept in view, anchored on the peak. */
  yWindow: number;
  /**
   * The frequency-axis scale. A caller that never offers the control keeps the
   * default (linear Hz); `spectrum` passes the `frequencyScale` view params.
   */
  frequencyScale?: FrequencyScale;
  /** An optional band between two adjacent series (e.g. the spectrum's min/max spread). */
  bands?: uPlot.Band[];
  /** Extra `draw` plugins appended to the synced stack (peak labels, band guides). */
  plugins?: UplotPluginFactory<AnalyzerBus>[];
  /** Extra remount key beyond the active theme (the chart's scale mode, an overlay toggle). */
  remountKey?: string;
  /** An optional reference curve on a secondary (dB SPL) axis. */
  reference?: FrequencyReference;
  /** The primary y-axis title (default `level (dB)`; masking names the calibrated unit). */
  yLabel?: string;
  /** Series named in the shared compact legend along the chart's bottom edge. */
  legend?: ChartLegendEntry[];
  /** A trailing fact for the legend (the calibration state, the axis mode). */
  legendNote?: string;
  /** Reports the frequency under the cursor, in Hz, or `null` when it leaves the plot. */
  onCursorMove?: (frequency: number | null) => void;
}

/**
 * The frequency-axis chart shared by the spectrum-style views (M30): zoom controls,
 * the synced uPlot stack, the frequency / dB axes, and a peak-anchored y window. The
 * caller owns the data, the series config, readouts and empty state.
 *
 * The x column is **physical Hz**; this chart applies the [`FrequencyScale`] transform
 * before handing it to uPlot, and inverts the cursor/range back to Hz, so sync with the
 * other frequency charts is always on physical Hz (see `frequencyScale.ts`).
 */
export default function FrequencyChart(props: FrequencyChartProps) {
  const scale = () => props.frequencyScale ?? "linearHz";

  /** The axis coordinate ↔ Hz conversion, shared by the sync plugins and the readouts. */
  const transform = () => frequencyAxisTransform(scale);
  const toHz = (value: number) => transform().toBus(value);

  const data = (): uPlot.AlignedData => {
    const [xs, ...rest] = props.data;
    const x = frequencyColumn(xs, scale());
    const reference = props.reference;
    const columns: (number | null)[][] = reference ? [...rest, reference.values] : rest;
    const aligned: [number[], ...(number | null)[][]] = [x, ...columns];
    return aligned;
  };

  const series = (): uPlot.Series[] => {
    const base: uPlot.Series[] = [{}, ...props.series];
    const reference = props.reference;
    if (!reference) return base;
    return [
      ...base,
      {
        label: reference.label,
        stroke: reference.stroke,
        width: 1.25,
        dash: reference.dash ?? [6, 4],
        scale: "y2",
        points: { show: false },
      },
    ];
  };

  const scales = (): uPlot.Scales => ({
    x: frequencyScaleXScale(scale()),
    y: {
      range: (_u, min, max): [number, number] => {
        const hi = Math.max(max, min + 6);
        return [Math.max(min, hi - props.yWindow), hi + 2];
      },
    },
    ...(props.reference
      ? {
          y2: {
            range: (_u: uPlot, min: number, max: number): [number, number] => [
              Math.max(0, Math.floor(min / 10) * 10 - 5),
              Math.ceil(max / 10) * 10 + 5,
            ],
          },
        }
      : {}),
  });

  const axes = (): uPlot.Axis[] => {
    const list: uPlot.Axis[] = [
      {
        ...chartAxisStyle(),
        label: frequencyScaleLabel(scale()),
        size: X_AXIS_SIZE,
        space: FREQ_AXIS_SPACE,
        values: frequencyScaleAxisValues(scale()),
      },
      {
        ...chartAxisStyle(),
        label: props.yLabel ?? "level (dB)",
        size: Y_AXIS_SIZE,
        space: Y_AXIS_SPACE,
      },
    ];
    if (props.reference) {
      list.push({
        ...chartAxisStyle(),
        scale: "y2",
        side: 1,
        label: "reference (dB SPL)",
        size: Y_AXIS_SIZE,
        space: Y_AXIS_SPACE,
      });
    }
    return list;
  };

  /** The visible band, labelled in physical Hz whatever the axis mode. */
  const rangeLabel = () => {
    const range = props.zoom.range();
    return range ? frequencyRangeLabel([toHz(range[0]), toHz(range[1])]) : "";
  };

  return (
    <div class="frequency-chart">
      <UplotChartPlot
        class="frequency-chart-plot"
        zoom={props.zoom}
        label={rangeLabel()}
        onWheel={props.zoom.wheel}
      >
        <Show when={`${activeThemeId()}|${props.remountKey ?? ""}`} keyed>
          <SolidUplot
            autoResize
            pluginBus={analyzerBus}
            plugins={[
              cursor(),
              tooltip(frequencyDbTooltip(scale)),
              mirrorCursor("freq", transform()),
              syncView("freq", transform()),
              ...(props.plugins ?? []),
            ]}
            onCreate={props.zoom.onReady}
            onCursorMove={(params) =>
              props.onCursorMove?.(params.cursor.visible ? toHz(params.cursor.xValue) : null)
            }
            data={data()}
            series={series()}
            bands={props.bands}
            scales={scales()}
            axes={axes()}
          />
        </Show>
      </UplotChartPlot>
      <Show when={(props.legend?.length ?? 0) > 0}>
        <ChartLegend entries={props.legend!} note={props.legendNote} />
      </Show>
    </div>
  );
}
