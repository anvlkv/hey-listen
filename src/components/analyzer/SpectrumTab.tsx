import { Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ToolParamsForm from "./ToolParamsForm";
import Readout from "./Readout";
import FrequencyChart from "./FrequencyChart";
import { createUplotZoom } from "./uplotZoom";
import { NoAudioState } from "./chartCommon";
import { chartTheme } from "../../state/themes";
import { useUplotImage } from "./chartImage";
import { createAnalysis, formatHz, toolOptions, type SpectrumResult } from "../../state/analyzer";

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
  const zoom = createUplotZoom("freq");

  // Export the rendered spectrum (M12).
  useUplotImage("spectrum", zoom.instance);

  /** A layer switch is a 0/1 select; default on when unset (e.g. an older project). */
  const layerOn = (key: LayerKey) => (toolOptions.spectrum?.[key] ?? 1) !== 0;

  /** Log-frequency x-axis (per-tool toggle; default on). */
  const logFreq = () => (toolOptions.spectrum?.logFreq ?? 1) !== 0;

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

  return (
    <AnalyzerTab
      id="spectrum"
      loading={analysis.loading()}
      error={analysis.error()}
      hasResult={analysis.result() != null}
      params={<ToolParamsForm id="spectrum" />}
    >
      <Show when={analysis.result()} fallback={<NoAudioState />}>
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
                {/* Remount when the axis mode or the theme changes: the wrapper fixes
                    `scales` at mount, so a log↔linear switch — and any theme switch,
                    which recolours the series — must rebuild the chart. */}
                <FrequencyChart
                  zoom={zoom}
                  data={data()}
                  series={LAYERS.map((layer) => ({
                    label: layer.label,
                    stroke: chartTheme()[layer.stroke],
                    width: layer.width,
                    dash: layer.dash,
                  }))}
                  yWindow={90}
                  logFreq={logFreq()}
                  remountKey={logFreq() ? "log" : "lin"}
                />
              </Show>
            </div>
          </div>
        )}
      </Show>
    </AnalyzerTab>
  );
}
