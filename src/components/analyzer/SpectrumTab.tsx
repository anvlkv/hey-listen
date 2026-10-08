import { SolidUplot, createPluginBus } from "@dschz/solid-uplot";
import { cursor, tooltip, type CursorPluginMessageBus, type TooltipProps } from "@dschz/solid-uplot/plugins";
import { Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ChartTooltip from "./ChartTooltip";
import Readout from "./Readout";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { createAnalysis, type SpectrumResult } from "../../state/analyzer";

const bus = createPluginBus<CursorPluginMessageBus>();

const AXIS = {
  stroke: "#8a8a8a",
  grid: { stroke: "#2b2b2b" },
  ticks: { stroke: "#2b2b2b" },
  font: "11px Inter, sans-serif",
};

const Tooltip = (props: TooltipProps) => (
  <ChartTooltip
    {...props}
    xLabel="f"
    formatX={(value) => formatHz(value)}
    formatY={(value) => `${value.toFixed(1)} dB`}
  />
);

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`;
}

/**
 * Spectrum tool: the averaged FFT magnitude of the conditioned signal over the
 * window (STFT magnitudes averaged per bin). See `docs/analysis-tools.md`.
 */
export default function SpectrumTab() {
  const analysis = createAnalysis<SpectrumResult>("spectrum");
  const zoom = createUplotZoom();

  const data = () => {
    const result = analysis.result();
    if (!result || result.freqs.length === 0) return [[]] as number[][];
    return [result.freqs, result.magDb];
  };

  const zoomLabel = () => {
    const range = zoom.range();
    return range ? `${formatHz(range[0])} – ${formatHz(range[1])}` : "";
  };

  return (
    <AnalyzerTab id="spectrum" loading={analysis.loading()} error={analysis.error()}>
      <Show
        when={analysis.result()}
        fallback={<div class="analyzer-empty">Open a source and set the analysis window.</div>}
      >
        {(result) => (
          <div class="analyzer-chart">
            <div class="analyzer-readouts">
              <Readout
                label="Peak"
                value={`${formatHz(result().peakHz)} · ${result().peakDb.toFixed(1)} dB`}
              />
              <Readout label="FFT" value={`${result().fftSize} · hop ${result().hopSize}`} />
              <Readout label="Frames" value={`${result().frames}`} />
              <Readout label="Rate" value={`${result().sampleRate} Hz`} />
            </div>
            <div class="analyzer-plot" onWheel={zoom.wheel}>
              <Show when={data()[0].length >= 2}>
                <ZoomControls
                  onZoomIn={zoom.zoomIn}
                  onZoomOut={zoom.zoomOut}
                  onFit={zoom.fit}
                  label={zoomLabel()}
                />
                <SolidUplot
                  autoResize
                  pluginBus={bus}
                  plugins={[cursor(), tooltip(Tooltip)]}
                  onCreate={zoom.onReady}
                  data={data()}
                  series={[{}, { label: "Magnitude", stroke: "#6ea8ff", width: 1 }]}
                  scales={{
                    x: { time: false },
                    y: {
                      // Keep roughly a 90 dB window in view, anchored on the peak.
                      range: (_u, min, max): [number, number] => {
                        const hi = Math.max(max, min + 6);
                        return [Math.max(min, hi - 90), hi + 2];
                      },
                    },
                  }}
                  axes={[{ ...AXIS, label: "frequency (Hz)" }, { ...AXIS, label: "level (dB)" }]}
                />
              </Show>
            </div>
          </div>
        )}
      </Show>
    </AnalyzerTab>
  );
}
