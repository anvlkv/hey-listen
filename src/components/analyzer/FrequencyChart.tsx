import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { Show } from "solid-js";
import ZoomControls from "./ZoomControls";
import { type UplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import {
  FREQ_AXIS_SPACE,
  frequencyAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import { chartAxisStyle, frequencyDbTooltip, frequencyRangeLabel } from "./chartCommon";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId } from "../../state/themes";

/** Keep a log x-axis strictly positive (the band-limited data may start at 0 Hz). */
function logXRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 1;
  const hi = max > lo ? max : lo * 2;
  return [lo, hi];
}

/** Props for the shared frequency-axis chart (spectrum and its masking overlay). */
export interface FrequencyChartProps {
  zoom: UplotZoom;
  data: uPlot.AlignedData;
  /** The y-series (the x-series placeholder is added here). */
  series: uPlot.Series[];
  /** The dB span kept in view, anchored on the peak. */
  yWindow: number;
  /** Draw a log-frequency x-axis. */
  logFreq?: boolean;
  /** Extra remount key beyond the active theme (e.g. a log-axis toggle). */
  remountKey?: string;
}

/**
 * The frequency-axis chart shared by the spectrum-style views (M30): zoom controls,
 * the synced uPlot stack, the frequency / dB axes, and a peak-anchored y window. The
 * caller owns the data, the series config, readouts and empty state.
 */
export default function FrequencyChart(props: FrequencyChartProps) {
  return (
    <>
      <ZoomControls
        onZoomIn={props.zoom.zoomIn}
        onZoomOut={props.zoom.zoomOut}
        onFit={props.zoom.fit}
        label={frequencyRangeLabel(props.zoom.range())}
      />
      <Show when={`${activeThemeId()}|${props.remountKey ?? ""}`} keyed>
        <SolidUplot
          autoResize
          pluginBus={analyzerBus}
          plugins={[cursor(), tooltip(frequencyDbTooltip), mirrorCursor("freq"), syncView("freq")]}
          onCreate={props.zoom.onReady}
          data={props.data}
          series={[{}, ...props.series]}
          scales={{
            x: props.logFreq
              ? { time: false, distr: 3, log: 10, range: logXRange }
              : { time: false },
            y: {
              range: (_u, min, max): [number, number] => {
                const hi = Math.max(max, min + 6);
                return [Math.max(min, hi - props.yWindow), hi + 2];
              },
            },
          }}
          axes={[
            {
              ...chartAxisStyle(),
              label: "frequency (Hz)",
              size: X_AXIS_SIZE,
              space: FREQ_AXIS_SPACE,
              values: frequencyAxisValues,
            },
            {
              ...chartAxisStyle(),
              label: "level (dB)",
              size: Y_AXIS_SIZE,
              space: Y_AXIS_SPACE,
            },
          ]}
        />
      </Show>
    </>
  );
}
