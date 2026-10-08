import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import { For, Show } from "solid-js";
import ChartTooltip from "./ChartTooltip";
import Readout from "./Readout";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { paddedYRange } from "./range";
import { coverage, seriesReadouts } from "./readouts";
import { analyzerBus } from "../../state/chartSync";
import {
  analyzerById,
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type SeriesResult,
  type SeriesView as SeriesViewConfig,
} from "../../state/analyzer";

const AXIS = {
  stroke: "#8a8a8a",
  grid: { stroke: "#2b2b2b" },
  ticks: { stroke: "#2b2b2b" },
  font: "11px Inter, sans-serif",
};

const isPitch = (id: AnalyzerId) => id.startsWith("pitch");

/**
 * Generic time-series view (M5): plots a tool's one-value-per-frame result against
 * time. The y-axis label / formatter and point style come from the tool's registry
 * entry, so every scalar-over-time tool shares this chart. Zoom and cursor are
 * synced with the other analyzer tabs on the `"time"` group. See
 * `docs/analysis-tools.md`.
 */
export default function SeriesView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const view = () => analyzerById(props.id).view as SeriesViewConfig;
  const result = () => props.analysis.result() as SeriesResult | null;
  const zoom = createUplotZoom();

  const Tooltip = (tooltipProps: TooltipProps) => (
    <ChartTooltip
      {...tooltipProps}
      xLabel="t"
      formatX={(value) => `${value.toFixed(3)} s`}
      formatY={view().formatY}
    />
  );

  const data = (): [number[], (number | null)[]] => {
    const r = result();
    if (!r || r.times.length === 0) return [[], []];
    return [r.times, r.values];
  };

  /** A chart needs at least two frames and some non-gap values. */
  const plottable = () => {
    const r = result();
    return !!r && r.times.length >= 2 && r.values.some((value) => value != null);
  };

  const zoomLabel = () => {
    const range = zoom.range();
    return range ? `${range[0].toFixed(3)} – ${range[1].toFixed(3)} s` : "";
  };

  return (
    <Show
      when={result()}
      fallback={<div class="analyzer-empty">Open a source and set the analysis window.</div>}
    >
      {(r) => (
        <div class="analyzer-chart">
          <div class="analyzer-readouts">
            <For each={seriesReadouts(r(), view().formatY)}>
              {(spec) => <Readout label={spec.label} value={spec.value} title={spec.title} />}
            </For>
            <Show when={isPitch(props.id)}>
              <Readout
                label="Voiced"
                value={`${(coverage(r().values) * 100).toFixed(0)}%`}
                title="Share of analysed frames with a detected pitch"
              />
            </Show>
          </div>
          <div class="analyzer-plot" onWheel={zoom.wheel}>
            <Show
              when={plottable()}
              fallback={
                <div class="analyzer-empty">
                  {isPitch(props.id)
                    ? "No voiced frames — the signal may be unpitched or polyphonic, or its fundamental may lie outside the detector's range (pYIN/YIN: 50–2000 Hz). Adjust the f0 range or try another detector."
                    : "No values in this window — widen the analysis window or change the FFT size."}
                </div>
              }
            >
              <ZoomControls
                onZoomIn={zoom.zoomIn}
                onZoomOut={zoom.zoomOut}
                onFit={zoom.fit}
                label={zoomLabel()}
              />
              <SolidUplot
                autoResize
                pluginBus={analyzerBus}
                plugins={[cursor(), tooltip(Tooltip), mirrorCursor("time"), syncView("time")]}
                onCreate={zoom.onReady}
                data={data()}
                series={[
                  {},
                  {
                    label: view().yLabel,
                    stroke: "#6ea8ff",
                    width: 1,
                    points: { show: view().points ?? false, size: 4 },
                  },
                ]}
                scales={{ x: { time: false }, y: { range: paddedYRange } }}
                axes={[{ ...AXIS, label: "time (s)" }, { ...AXIS, label: view().yLabel }]}
              />
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
