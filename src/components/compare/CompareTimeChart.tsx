import { SolidUplot, type UplotPluginFactory } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { untrack, type Component } from "solid-js";
import { analyzerBus, type AnalyzerBus, type AxisTransform } from "../../state/chartSync";
import { mirrorCursor, syncView } from "../analyzer/syncPlugins";
import type { UplotZoom } from "../analyzer/uplotZoom";

/**
 * The uPlot the time-axis compare views share (M25.A): one sync / cursor / tooltip
 * plugin stack on A's `"time"` group, so every family's chart behaves identically.
 * The data, series, scales and axes stay at the call site because each family
 * declares different ones.
 */
export default function CompareTimeChart(props: {
  zoom: UplotZoom;
  Tooltip: Component<TooltipProps>;
  /** The shared x-axis (source seconds on the relative compare axis). */
  axis: () => AxisTransform;
  markers: UplotPluginFactory<AnalyzerBus>;
  data: uPlot.AlignedData;
  series: uPlot.Series[];
  scales: uPlot.Scales;
  axes: uPlot.Axis[];
}) {
  return (
    <SolidUplot
      autoResize
      pluginBus={analyzerBus}
      plugins={[
        cursor(),
        tooltip(props.Tooltip),
        mirrorCursor("time", untrack(props.axis)),
        syncView("time", untrack(props.axis)),
        props.markers,
      ]}
      onCreate={props.zoom.onReady}
      data={props.data}
      series={props.series}
      scales={props.scales}
      axes={props.axes}
    />
  );
}
