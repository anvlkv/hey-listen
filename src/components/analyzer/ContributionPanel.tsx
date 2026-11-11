import { createMemo, Show, type Accessor } from "solid-js";
import ChartLegend from "./chartLegend";
import HeatmapPanel, {
  companionTimeRange,
  timeHeatmapAxis,
  type PaintHeatmap,
  type HeatmapAxis,
} from "./HeatmapPanel";
import { buildHeatmapImage, paintFrameGrid } from "./chartCanvas";
import { resolveHeatmapScale } from "./heatmapScale";
import { bandIndexValues, Y_AXIS_SPACE } from "./axisFormat";
import { chartTheme } from "../../state/themes";
import type { Contribution } from "../../bindings/Contribution";
import { type CalibratedSeriesResult, type SeriesResult } from "../../state/analyzer";
import type { UplotZoom } from "./uplotZoom";
import { cursorTimeMarks } from "./verticalMarkers";
import { frameTimeExtent } from "./chartGeometry";

/**
 * The per-band drill-down under a perception track (M36): the `contribution` grid a
 * calibrated series tool carries, drawn as a frames × bands heatmap on the timeline
 * chart's own time axis.
 *
 * The horizontal axis is the **chart's** visible range (`UplotZoom`), not a second
 * pan/zoom path, so a zoom on the timeline moves the panel with it; the dashed rule is
 * the shared `"time"` cursor mirrored through the existing mark plugin. The pixels and
 * the colourbar come from one [`HeatmapScale`](./heatmapScale.ts).
 *
 * Every grid axis is checked first: YIN/autocorrelation results and fixtures written
 * before the field existed have no `contribution`, so the panel renders nothing.
 */
export default function ContributionPanel(props: {
  result: Accessor<SeriesResult | null>;
  zoom: UplotZoom;
}) {
  const grid = createMemo<Contribution | null>(() => {
    const payload = (props.result() as Partial<CalibratedSeriesResult> | null)?.contribution;
    if (!payload) return null;
    const complete =
      payload.frames > 0 &&
      payload.bins > 0 &&
      payload.times.length >= payload.frames &&
      payload.bands.length >= payload.bins &&
      payload.values.length >= payload.frames * payload.bins;
    return complete ? payload : null;
  });

  /** The one scale the image and its colourbar share. */
  const panel = createMemo(() => {
    const contribution = grid();
    if (!contribution) return null;
    let max = 0;
    const cells = contribution.frames * contribution.bins;
    for (let i = 0; i < cells; i++) {
      const value = contribution.values[i];
      if (Number.isFinite(value) && value > max) max = value;
    }
    const scale = resolveHeatmapScale({ min: 0, max, unit: contribution.unit ?? null });
    const image = buildHeatmapImage(
      contribution.frames,
      contribution.bins,
      0,
      1,
      (frame, band) => scale.position(contribution.values[frame * contribution.bins + band]),
      scale.ramp,
    );
    return image ? { scale, image } : null;
  });

  /** The grid's own time extent (the frame centres), or `null` without a grid. */
  const extent = (): [number, number] | null => {
    const contribution = grid();
    return contribution ? frameTimeExtent(contribution.times, contribution.frames) : null;
  };

  /** The timeline chart's visible range, so the panel's time axis aligns with it. */
  const visible = (): [number, number] => companionTimeRange(extent(), props.zoom.range);

  /** Blit the visible slice of the frame grid; a view past the grid clips to background. */
  const paint: PaintHeatmap = (ctx, box, source, u) => {
    const contribution = grid();
    if (!contribution) return;
    paintFrameGrid(ctx, source, box, u, contribution.times, contribution.frames, contribution.bins);
  };

  const xAxis = (): HeatmapAxis => timeHeatmapAxis(visible);

  /** The band axis labels, kept as memo accessors so a new result relabels the ticks. */
  const bands = createMemo(() => grid()?.bands ?? []);
  const bins = createMemo(() => grid()?.bins ?? 0);

  /** What a cell is, in the tool's own label and unit (never a second list of ids). */
  const scaleLabel = (): string => {
    const contribution = grid();
    if (!contribution) return "";
    const unit = contribution.unit ? ` (${contribution.unit})` : "";
    return `${contribution.label}${unit}`;
  };

  const yAxis = (): HeatmapAxis => ({
    range: () => [-0.5, bins() - 0.5],
    label: "band (Hz)",
    values: bandIndexValues(bands, bins),
    space: Y_AXIS_SPACE,
  });

  return (
    <Show when={panel()}>
      {(ready) => (
        <div class="contribution-panel">
          <HeatmapPanel
            testid="contribution.panel"
            title={() => "Per-band contribution"}
            image={() => panel()?.image ?? null}
            paint={paint}
            x={xAxis()}
            y={yAxis()}
            marks={cursorTimeMarks}
            scale={ready().scale}
            scaleLabel={scaleLabel()}
          />
          <ChartLegend
            entries={[{ label: "shared cursor", color: chartTheme().mirror, kind: "dashed" }]}
            note={`${scaleLabel()} — each cell is that band's share of the frame's value`}
          />
        </div>
      )}
    </Show>
  );
}
