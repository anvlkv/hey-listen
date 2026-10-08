import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import { Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ChartTooltip from "./ChartTooltip";
import Readout from "./Readout";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { analyzerBus } from "../../state/chartSync";
import { createAnalysis, type WaveformResult } from "../../state/analyzer";

const AXIS = {
  stroke: "#8a8a8a",
  grid: { stroke: "#2b2b2b" },
  ticks: { stroke: "#2b2b2b" },
  font: "11px Inter, sans-serif",
};

const Tooltip = (props: TooltipProps) => (
  <ChartTooltip
    {...props}
    xLabel="t"
    formatX={(value) => `${value.toFixed(3)} s`}
    formatY={(value) => value.toFixed(3)}
  />
);

/**
 * Waveform tool: the min/max envelope of the **conditioned** signal over the
 * analysis window, with peak / RMS levels from oxiaudio. See
 * `docs/analysis-tools.md`.
 */
export default function WaveformTab() {
  const analysis = createAnalysis<WaveformResult>("waveform");
  const zoom = createUplotZoom();

  const data = () => {
    const result = analysis.result();
    if (!result || result.max.length === 0) return [[]] as number[][];
    const count = result.max.length;
    const step = count > 0 ? result.duration / count : 0;
    const times = new Array<number>(count);
    for (let i = 0; i < count; i++) times[i] = i * step;
    return [times, result.max, result.min];
  };

  const zoomLabel = () => {
    const range = zoom.range();
    return range ? `${range[0].toFixed(3)} – ${range[1].toFixed(3)} s` : "";
  };

  return (
    <AnalyzerTab
      id="waveform"
      loading={analysis.loading()}
      error={analysis.error()}
      hasResult={analysis.result() != null}
    >
      <Show
        when={analysis.result()}
        fallback={<div class="analyzer-empty">Open a source and set the analysis window.</div>}
      >
        {(result) => (
          <div class="analyzer-chart">
            <div class="analyzer-readouts">
              <Readout label="Peak" value={`${result().peakDb.toFixed(1)} dBFS`} />
              <Readout label="RMS" value={`${result().rmsDb.toFixed(1)} dBFS`} />
              <Readout label="Duration" value={`${result().duration.toFixed(3)} s`} />
              <Readout label="Rate" value={`${result().sampleRate} Hz`} />
            </div>
            <div class="analyzer-plot" onWheel={zoom.wheel}>
              <Show
                when={data()[0].length >= 2}
                fallback={
                  <div class="analyzer-empty">
                    Empty window — widen the analysis window.
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
                    { label: "Max", stroke: "#6ea8ff", width: 1 },
                    { label: "Min", stroke: "#6ea8ff", width: 1 },
                  ]}
                  bands={[{ series: [1, 2], fill: "rgba(110, 168, 255, 0.22)" }]}
                  scales={{ x: { time: false } }}
                  axes={[{ ...AXIS, label: "time (s)" }, { ...AXIS, label: "amplitude" }]}
                />
              </Show>
            </div>
          </div>
        )}
      </Show>
    </AnalyzerTab>
  );
}
