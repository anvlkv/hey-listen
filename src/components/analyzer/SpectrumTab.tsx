import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import { Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ChartTooltip from "./ChartTooltip";
import Readout from "./Readout";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import {
  FREQ_AXIS_SPACE,
  frequencyAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import { analyzerBus } from "../../state/chartSync";
import { chartTheme, resolvedTheme } from "../../state/settings";
import { createAnalysis, toolOptions, type SpectrumResult } from "../../state/analyzer";

/** uPlot axis styling for the active theme (read on each chart (re)mount). */
function axisStyle() {
  const t = chartTheme();
  return { stroke: t.axis, grid: { stroke: t.grid }, ticks: { stroke: t.ticks }, font: t.font };
}

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

/** Per-tool switch (a 0/1 `select`) that shows one magnitude layer. */
type LayerKey = "showMin" | "showMax" | "showMean";

interface Layer {
  key: LayerKey;
  label: string;
  /** Which [`ChartTheme`] field supplies the stroke, so the layer is theme-aware. */
  stroke: "seriesMin" | "seriesMax" | "seriesMean";
  width: number;
  dash?: number[];
  /** The layer's per-bin dBFS values for a result. */
  db: (result: SpectrumResult) => number[];
}

/** Draw order: the mean line is drawn last, so it sits on top of the min/max band. */
const LAYERS: [Layer, Layer, Layer] = [
  { key: "showMin", label: "min", stroke: "seriesMin", width: 1, dash: [4, 3], db: (r) => r.minDb },
  { key: "showMax", label: "max", stroke: "seriesMax", width: 1, dash: [4, 3], db: (r) => r.maxDb },
  { key: "showMean", label: "mean", stroke: "seriesMean", width: 1.5, db: (r) => r.magDb },
];

/**
 * Spectrum tool: the averaged FFT magnitude of the conditioned signal over the
 * window (STFT magnitudes averaged per bin), with optional per-bin min / max
 * layers showing how the magnitude spread across the window's frames. See
 * `docs/analysis-tools.md`.
 */
export default function SpectrumTab() {
  const analysis = createAnalysis<SpectrumResult>("spectrum");
  const zoom = createUplotZoom();

  /** A layer switch is a 0/1 select; default on when unset (e.g. an older project). */
  const layerOn = (key: LayerKey) => (toolOptions.spectrum?.[key] ?? 1) !== 0;

  /** A layer is plottable when it is switched on and carries one value per bin. */
  const layerReady = (layer: Layer, result: SpectrumResult) =>
    layerOn(layer.key) && layer.db(result).length === result.freqs.length;

  /** The layer's column, or all-gaps when it is off / empty (uPlot then draws nothing). */
  const column = (layer: Layer, result: SpectrumResult): (number | null)[] =>
    layerReady(layer, result) ? layer.db(result) : result.freqs.map(() => null);

  // The three series are declared statically (the wrapper fixes `series` at mount),
  // so an inactive layer is carried as an all-null column instead of being removed.
  const data = (): [number[], (number | null)[], (number | null)[], (number | null)[]] => {
    const result = analysis.result();
    if (!result || result.freqs.length === 0) return [[], [], [], []];
    return [
      result.freqs,
      column(LAYERS[0], result),
      column(LAYERS[1], result),
      column(LAYERS[2], result),
    ];
  };

  const hasData = () => {
    const result = analysis.result();
    return !!result && result.freqs.length >= 2 && LAYERS.some((l) => layerReady(l, result));
  };

  const zoomLabel = () => {
    const range = zoom.range();
    return range ? `${formatHz(range[0])} – ${formatHz(range[1])}` : "";
  };

  return (
    <AnalyzerTab
      id="spectrum"
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
              <Readout
                label="Peak"
                value={`${formatHz(result().peakHz)} · ${result().peakDb.toFixed(1)} dB`}
              />
              <Readout label="FFT" value={`${result().fftSize} · hop ${result().hopSize}`} />
              <Readout label="Frames" value={`${result().frames}`} />
              <Readout label="Rate" value={`${result().sampleRate} Hz`} />
            </div>
            <div class="analyzer-plot" onWheel={zoom.wheel}>
              <Show
                when={hasData()}
                fallback={
                  <div class="analyzer-empty">
                    Empty window — widen the analysis window or lower the FFT size.
                  </div>
                }
              >
                <ZoomControls
                  onZoomIn={zoom.zoomIn}
                  onZoomOut={zoom.zoomOut}
                  onFit={zoom.fit}
                  label={zoomLabel()}
                />
                <Show when={resolvedTheme()} keyed>
                  <SolidUplot
                    autoResize
                    pluginBus={analyzerBus}
                    plugins={[cursor(), tooltip(Tooltip), mirrorCursor("freq"), syncView("freq")]}
                    onCreate={zoom.onReady}
                    data={data()}
                    series={[
                      {},
                      ...LAYERS.map((layer) => ({
                        label: layer.label,
                        stroke: chartTheme()[layer.stroke],
                        width: layer.width,
                        dash: layer.dash,
                      })),
                    ]}
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
                    axes={[
                      {
                        ...axisStyle(),
                        label: "frequency (Hz)",
                        size: X_AXIS_SIZE,
                        space: FREQ_AXIS_SPACE,
                        values: frequencyAxisValues,
                      },
                      { ...axisStyle(), label: "level (dB)", size: Y_AXIS_SIZE, space: Y_AXIS_SPACE },
                    ]}
                  />
                </Show>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </AnalyzerTab>
  );
}
