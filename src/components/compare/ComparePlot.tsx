import type { JSX } from "solid-js";
import { ChartPlot, timeRangeLabel } from "../analyzer/chartCommon";
import type { UplotZoom } from "../analyzer/uplotZoom";

/**
 * The plot wrapper the time-axis compare charts share (M25.A, M36): the shared
 * [`ChartPlot`](../analyzer/chartCommon.tsx) surface — wheel zoom, the right-click hook
 * is the caller's, and the zoom chrome revealed only while the chart is in use. The
 * chart itself (and its keyed theme remount) stays at the call site, because each
 * family declares different series.
 */
export default function ComparePlot(options: { zoom: UplotZoom; children: JSX.Element }) {
  return (
    <ChartPlot
      zoom={{
        zoomIn: options.zoom.zoomIn,
        zoomOut: options.zoom.zoomOut,
        fit: options.zoom.fit,
        label: timeRangeLabel(options.zoom.range()),
        zoomed: !options.zoom.fitted(),
      }}
      onWheel={options.zoom.wheel}
    >
      {options.children}
    </ChartPlot>
  );
}
