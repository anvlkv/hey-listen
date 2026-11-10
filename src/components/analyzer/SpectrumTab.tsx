import { createMemo, createSignal, Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ToolParamsForm from "./ToolParamsForm";
import Readout from "./Readout";
import FrequencyChart from "./FrequencyChart";
import ChartLegend, { type ChartLegendEntry } from "./chartLegend";
import { createUplotZoom } from "./uplotZoom";
import { NoAudioState } from "./chartCommon";
import { chartTheme } from "../../state/themes";
import { useUplotImage } from "./chartImage";
import { contourAt } from "../../lib/equalLoudness";
import {
  bandGuideLines,
  bandGuideOf,
  detectSpectralPeaks,
  spectralPeakLabels,
} from "./frequencyOverlays";
import { frequencyAxisTransform, frequencyScaleOf } from "./frequencyScale";
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
 *
 * The chart is made **explanatory** (M36): the layers are named in a shared legend, the
 * min/max pair is shaded as one band, prominent peaks are labelled in Hz, and the
 * frequency axis offers linear / log Hz and the auditory Bark / ERB rates.
 */
export default function SpectrumTab() {
  const analysis = createAnalysis<SpectrumResult>("spectrum");
  /** The per-tool frequency-axis scale (view-only; the engine never sees it). */
  const frequencyScale = () => frequencyScaleOf(toolOptions.spectrum?.frequencyScale);
  /** The frequency sync group is in physical Hz, whatever mode this chart draws. */
  const zoom = createUplotZoom("freq", frequencyAxisTransform(frequencyScale));

  // Export the rendered spectrum (M12).
  useUplotImage("spectrum", zoom.instance);

  /** A layer switch is a 0/1 select; default on when unset (e.g. an older project). */
  const layerOn = (key: LayerKey) => (toolOptions.spectrum?.[key] ?? 1) !== 0;

  /** Optional octave / Bark / ERB boundary guides (view-only, off by default). */
  const bandGuide = () => bandGuideOf(toolOptions.spectrum?.bandGuides);

  /** Selected equal-loudness contour phon level (`0` = off). */
  const phonLevel = () => toolOptions.spectrum?.phonLevel ?? 0;

  /** The frequency under the cursor (always Hz, whatever the axis mode). */
  const [cursorFreq, setCursorFreq] = createSignal<number | null>(null);

  /** The labelled spectral peaks: prominent local maxima, not every FFT-bin wiggle. */
  const peaks = createMemo(() => {
    const result = analysis.result();
    return result ? detectSpectralPeaks(result.freqs, result.magDb) : [];
  });

  /** The selected contour as a dB SPL reference curve, one value per frequency bin. */
  const reference = () => {
    const result = analysis.result();
    const phon = phonLevel();
    if (!result || phon <= 0) return undefined;
    return {
      values: result.freqs.map((freq) => contourAt(phon, freq)),
      label: `${phon} phon contour`,
      stroke: chartTheme().reference,
      dash: [6, 4],
    };
  };

  /** The contour's level at the cursor frequency, in dB SPL. */
  const referenceAtCursor = () => {
    const freq = cursorFreq();
    const phon = phonLevel();
    return phon > 0 && freq != null ? contourAt(phon, freq) : null;
  };

  /** A layer is plottable when it is switched on and carries one value per bin. */
  const layerReady = (layer: Layer, result: SpectrumResult) =>
    layerOn(layer.key) && layer.db(result).length === result.freqs.length;

  /** The layer's column, or all-gaps when it is off / empty (uPlot then draws nothing). */
  const column = (layer: Layer, result: SpectrumResult): (number | null)[] =>
    layerReady(layer, result) ? layer.db(result) : result.freqs.map(() => null);

  // The three series are declared statically (the wrapper fixes `series` at mount),
  // so an inactive layer is carried as an all-null column instead of being removed.
  // The x column stays physical Hz: `FrequencyChart` applies the axis scale.
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

  /** The drawn layers, named in the shared legend (a band stands for min + max together). */
  const legend = (): ChartLegendEntry[] =>
    LAYERS.filter((layer) => layerOn(layer.key)).map((layer) => ({
      label: layer.label,
      color: chartTheme()[layer.stroke],
      kind: layer.key === "showMean" ? "line" : "dashed",
    }));

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
              <Show when={phonLevel() > 0}>
                <Readout
                  label="Contour"
                  value={`${phonLevel()} phon`}
                  title="Equal-loudness reference curve, in dB SPL."
                />
                <Readout
                  label="Ref @ cursor"
                  value={
                    referenceAtCursor() == null ? "—" : `${referenceAtCursor()!.toFixed(1)} dB SPL`
                  }
                  title="The contour's level at the cursor frequency. The spectrum is dBFS; the two scales align only when it is calibrated."
                />
              </Show>
            </div>
            <div class="analyzer-plot">
              <Show
                when={hasData()}
                fallback={
                  <div class="analyzer-empty">
                    Empty window — widen the analysis window or lower the FFT size.
                  </div>
                }
              >
                {/* Remount when the axis mode, an overlay or the theme changes: the
                    wrapper fixes `scales` and `series` at mount, so a log↔Bark switch —
                    and any theme switch, which recolours the series — must rebuild. */}
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
                  frequencyScale={frequencyScale()}
                  bands={
                    layerOn("showMin") && layerOn("showMax")
                      ? [{ series: [1, 2], fill: chartTheme().waveFill }]
                      : undefined
                  }
                  plugins={[
                    bandGuideLines(bandGuide, frequencyScale),
                    spectralPeakLabels(peaks, frequencyScale),
                  ]}
                  remountKey={`${frequencyScale()}|${bandGuide()}|${phonLevel()}`}
                  reference={reference()}
                  onCursorMove={setCursorFreq}
                />
              </Show>
            </div>
            <ChartLegend
              entries={legend()}
              note={peaks().length > 0 ? `${peaks().length} peaks` : undefined}
            />
          </div>
        )}
      </Show>
    </AnalyzerTab>
  );
}
