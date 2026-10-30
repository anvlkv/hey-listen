import type { JSX } from "solid-js";
import ZoomControls from "../analyzer/ZoomControls";
import { timeRangeLabel } from "../analyzer/chartCommon";
import type { UplotZoom } from "../analyzer/uplotZoom";

/**
 * The plot wrapper the time-axis compare charts share (M25.A): the wheel-zoom surface
 * and the zoom / fit controls above the chart. The chart itself (and its keyed theme
 * remount) stays at the call site, because each family declares different series.
 */
export default function ComparePlot(options: { zoom: UplotZoom; children: JSX.Element }) {
  return (
    <div class="analyzer-plot" onWheel={(event) => options.zoom.wheel(event)}>
      <ZoomControls
        onZoomIn={options.zoom.zoomIn}
        onZoomOut={options.zoom.zoomOut}
        onFit={options.zoom.fit}
        label={timeRangeLabel(options.zoom.range())}
      />
      {options.children}
    </div>
  );
}
