import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { Show, untrack } from "solid-js";
import ZoomControls from "./ZoomControls";
import { type UplotZoom } from "./uplotZoom";
import { mirrorCursor, playheadRule, syncView } from "./syncPlugins";
import { referenceLine, semitoneGrid } from "./seriesPlugins";
import { annotationMarkers } from "./annotationPlugins";
import { paddedYRange } from "./range";
import {
  frequencyAxisValues,
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import { chartAxisStyle, timeRangeLabel, timeTooltip } from "./chartCommon";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import type { AnalyzerId } from "../../state/analyzer";

/** A log-scale y-range with a little headroom, clamped so it never reaches 0. */
function logYRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 0.1;
  const hi = max > lo ? max : lo * 10;
  return [lo / 1.15, hi * 1.15];
}

/** Impulse ("stem") path builder: a vertical line from the plot floor to each value. */
const stemsPath = (
  u: uPlot,
  seriesIdx: number,
  idx0: number,
  idx1: number,
): uPlot.Series.Paths | null => {
  const path = new Path2D();
  const base = u.bbox.top + u.bbox.height;
  const xs = u.data[0];
  const ys = u.data[seriesIdx];
  if (!xs || !ys) return null;
  for (let i = idx0; i <= idx1; i++) {
    const value = ys[i];
    const x = xs[i];
    if (typeof value !== "number" || typeof x !== "number" || !Number.isFinite(value)) continue;
    const px = u.valToPos(x, "x", true);
    const py = u.valToPos(value, "y", true);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    path.moveTo(px, base);
    path.lineTo(px, py);
  }
  return { stroke: path };
};

/** Props for the shared 1-D time chart (series tracks and the loudness curve). */
export interface TimeSeriesChartProps {
  id: AnalyzerId;
  zoom: UplotZoom;
  data: [number[], (number | null)[]];
  yLabel: string;
  formatY: (value: number) => string;
  seriesStyle?: "line" | "area" | "stepped" | "stems";
  points?: boolean;
  yScale?: "linear" | "log";
  yRange?: [number, number];
  reference?: { value: number; label: string };
  semitoneGrid?: boolean;
  /** Label the y-axis in Hz too (pitch tracks). */
  frequencyY?: boolean;
}

/**
 * The chart body shared by the time-series views (M5, M27): zoom controls plus the
 * synced uPlot stack. The caller owns the surrounding readouts and empty state.
 */
export default function TimeSeriesChart(props: TimeSeriesChartProps) {
  const Tooltip = timeTooltip(untrack(() => props.formatY));
  const style = () => props.seriesStyle ?? "line";
  const paths = () => {
    if (style() === "stepped") return uPlot.paths.stepped?.({ align: 1 });
    if (style() === "stems") return stemsPath;
    return undefined;
  };

  return (
    <>
      <ZoomControls
        onZoomIn={props.zoom.zoomIn}
        onZoomOut={props.zoom.zoomOut}
        onFit={props.zoom.fit}
        label={timeRangeLabel(props.zoom.range())}
      />
      <Show when={activeThemeId()} keyed>
        <SolidUplot
          autoResize
          pluginBus={analyzerBus}
          plugins={[
            cursor(),
            tooltip(Tooltip),
            mirrorCursor("time"),
            syncView("time"),
            playheadRule(),
            annotationMarkers(props.id),
            ...(props.reference ? [referenceLine(props.reference)] : []),
            ...(props.semitoneGrid ? [semitoneGrid()] : []),
          ]}
          onCreate={props.zoom.onReady}
          data={props.data}
          series={[
            {},
            {
              label: props.yLabel,
              stroke: chartTheme().series,
              width: 1,
              fill: style() === "area" ? chartTheme().waveFill : undefined,
              points: { show: props.points ?? false, size: 4 },
              paths: paths(),
            },
          ]}
          scales={{
            x: { time: false },
            y:
              props.yScale === "log"
                ? { distr: 3, log: 10, range: logYRange }
                : { range: props.yRange ? () => props.yRange! : paddedYRange },
          }}
          axes={[
            {
              ...chartAxisStyle(),
              label: "time (s)",
              size: X_AXIS_SIZE,
              space: TIME_AXIS_SPACE,
              values: timeAxisValues,
            },
            {
              ...chartAxisStyle(),
              label: props.yLabel,
              size: Y_AXIS_SIZE,
              space: Y_AXIS_SPACE,
              values: props.frequencyY ? frequencyAxisValues : undefined,
            },
          ]}
        />
      </Show>
    </>
  );
}
