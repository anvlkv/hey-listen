import uPlot from "uplot";
import { For, Show } from "solid-js";
import Readout from "./Readout";
import FrequencyChart, { type FrequencyReference } from "./FrequencyChart";
import type { ChartLegendEntry } from "./chartLegend";
import { createUplotZoom } from "./uplotZoom";
import { verticalMarks, type VerticalMark } from "./verticalMarkers";
import { NoAudioState } from "./chartCommon";
import { chartTheme } from "../../state/themes";
import { useUplotImage } from "./chartImage";
import {
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type MaskingResult,
} from "../../state/analyzer";

/**
 * Vertical bands between the spectrum and the global masking threshold wherever a
 * bin is masked (`smrDb < 0`). The series' own values carry the spectrum level at
 * those bins; the builder reads the threshold curve (`tg` column) for the other end.
 *
 * It is the chart's **first** series, so the comb sits under the level curves it
 * explains rather than over them — with a mostly-masked window the bands would
 * otherwise paint a solid block across the spectrum.
 */
const maskedBands = (
  u: uPlot,
  seriesIdx: number,
  idx0: number,
  idx1: number,
): uPlot.Series.Paths | null => {
  const path = new Path2D();
  const xs = u.data[0];
  const spectrum = u.data[seriesIdx];
  const threshold = u.data[TG_COLUMN];
  if (!xs) return null;
  for (let i = idx0; i <= idx1; i++) {
    const x = xs[i];
    const top = spectrum?.[i];
    const bottom = threshold?.[i];
    if (typeof x !== "number" || typeof top !== "number" || typeof bottom !== "number") continue;
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
    const px = u.valToPos(x, "x", true);
    const pyTop = u.valToPos(top, "y", true);
    const pyBottom = u.valToPos(bottom, "y", true);
    if (!Number.isFinite(px) || !Number.isFinite(pyTop) || !Number.isFinite(pyBottom)) continue;
    path.moveTo(px, pyTop);
    path.lineTo(px, pyBottom);
  }
  return { stroke: path };
};

/**
 * The data columns: `[x, masked, spectrum, Tq, Tg]`. The masked bands come first so they
 * are drawn under the curves; `maskedBands` reads `Tg` at [`TG_COLUMN`], and the level
 * window is anchored on the spectrum, not on a threshold's out-of-range ceiling.
 */
const SPECTRUM_COLUMN = 2;
const TG_COLUMN = 4;

/**
 * The SMR's right-hand range always contains the 0 dB threshold, so "above / below the
 * masking threshold" is readable even when every bin sits on one side of it.
 */
function smrRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const pad = Math.max((hi - lo) * 0.08, 0.5);
  return [lo - pad, hi + pad];
}

/**
 * Masking view (M30, M36, M38): the averaged spectrum with the threshold in quiet `Tq`
 * and the global masking threshold `Tg` on one **level** axis, and the
 * signal-to-mask ratio on the right-hand **SMR** axis of the same plot. Masked bins
 * (negative SMR) are drawn as bands between the level and `Tg` — the bands *are* the
 * negative SMR, so the ratio curve and the bands share one colour.
 *
 * The two quantities keep their own scales (a ratio must never be plotted on a level
 * axis), but they share one frequency axis, so one plot replaces the stacked pair of
 * panels: no second axis row, no second legend, no second zoom chrome.
 *
 * The level axis is `level (dB SPL)` only when the run is calibrated; otherwise it is
 * `relative level (dB)` and the legend says `Tq` is dB SPL — the two are not directly
 * comparable without calibration. Zoom and cursor are synced with the other frequency
 * charts on the `"freq"` group.
 *
 * The model's individual maskers are drawn on the level panel as vertical rules, tonal
 * and residual in distinct colours (their own legend entries), so a threshold can be
 * read against what actually produced it rather than only the resulting curve.
 */
export default function MaskingView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const result = () => props.analysis.result() as MaskingResult | null;
  const levelZoom = createUplotZoom("freq");

  // The tab's PNG export follows the one plot.
  useUplotImage(() => props.id, levelZoom.instance);

  /** The masked bins' level, drawn as bands down to `Tg` (they are the negative SMR). */
  const masked = (r: MaskingResult) => r.smrDb.map((smr, i) => (smr < 0 ? r.spectrumDb[i] : null));

  /**
   * The SMR on the plot's right-hand axis: its own scale, on the shared frequency axis.
   * Bins the analyser left non-finite become gaps rather than zeros.
   */
  const smrReference = (r: MaskingResult | null): FrequencyReference | undefined => {
    if (!r) return undefined;
    return {
      values: r.smrDb.map((value) => (Number.isFinite(value) ? value : null)),
      label: "SMR",
      stroke: chartTheme().markerDownbeat,
      dash: [],
      axisLabel: "SMR (dB)",
      range: smrRange,
      inTooltip: true,
      // A per-bin quotient is far noisier than the level curves: keep it a backdrop so
      // the spectrum and the thresholds stay the chart's subject.
      alpha: 0.5,
    };
  };

  /** The maskers the model summed into `Tg` (empty for a result stored before M36). */
  const maskers = () => result()?.maskers ?? [];

  /** One vertical rule per masker, tonal and residual in their own colour/dash. */
  const maskerMarks = (): VerticalMark[] =>
    maskers()
      .filter((masker) => Number.isFinite(masker.hz))
      .map((masker) => ({
        at: masker.hz,
        color: masker.tonal ? chartTheme().markerBeat : chartTheme().filtered,
        dash: masker.tonal ? undefined : [2, 3],
      }));

  const maskerPlugins = () => [verticalMarks(maskerMarks)];

  // The series are declared statically (the wrapper fixes `series` at mount).
  const data = (): [
    number[],
    (number | null)[],
    (number | null)[],
    (number | null)[],
    (number | null)[],
  ] => {
    const r = result();
    if (!r || r.freqs.length === 0) return [[], [], [], [], []];
    return [r.freqs, masked(r), r.spectrumDb, r.thresholdQuietDb, r.globalMaskDb];
  };

  const hasData = () => {
    const r = result();
    return !!r && r.freqs.length >= 2 && r.spectrumDb.length === r.freqs.length;
  };

  /** A calibrated run measures dB SPL; otherwise the spectrum is relative. */
  const levelLabel = () => (result()?.calibrated ? "level (dB SPL)" : "relative level (dB)");

  const legend = (): ChartLegendEntry[] => {
    const rows: ChartLegendEntry[] = [
      { label: "spectrum", color: chartTheme().seriesMean },
      { label: "threshold in quiet (Tq)", color: chartTheme().seriesMin, kind: "dashed" },
      { label: "masking threshold (Tg)", color: chartTheme().seriesMax, kind: "dashed" },
      { label: "SMR (right axis)", color: chartTheme().markerDownbeat },
      { label: "masked (SMR < 0)", color: chartTheme().markerDownbeat, kind: "fill" },
    ];
    if (maskers().length > 0) {
      rows.push(
        { label: "tonal masker", color: chartTheme().markerBeat },
        { label: "residual masker", color: chartTheme().filtered, kind: "dashed" },
      );
    }
    return rows;
  };

  const legendNote = () => {
    const r = result();
    if (!r) return undefined;
    const calibration = r.calibrated
      ? `${r.calibrationDbSpl.toFixed(1)} dB SPL calibrated`
      : "uncalibrated — spectrum dBFS, Tq dB SPL";
    const count = maskers().length;
    return count > 0 ? `${calibration} · ${count} maskers` : calibration;
  };

  const readouts = () => {
    const r = result();
    if (!r) return [];
    const smr = r.smrDb.filter((value) => Number.isFinite(value));
    const min = smr.length ? Math.min(...smr) : 0;
    const max = smr.length ? Math.max(...smr) : 0;
    const maskedBins = smr.filter((value) => value < 0).length;
    const maskerCount = maskers().length;
    const tonalCount = maskers().filter((masker) => masker.tonal).length;
    return [
      {
        label: "SMR",
        value: `${min.toFixed(1)} … ${max.toFixed(1)} dB`,
        title:
          "Signal-to-mask ratio range — positive means above the estimated threshold (its own panel below)",
      },
      {
        label: "Masked",
        value: `${maskedBins} / ${smr.length} bins`,
        title: "Bins whose level sits under the global masking threshold",
      },
      ...(maskerCount > 0
        ? [
            {
              label: "Maskers",
              value: `${maskerCount} (${tonalCount} tonal)`,
              title:
                "Tonal and residual maskers the model spread over the Bark axis — the vertical rules on the level panel",
            },
          ]
        : []),
      {
        label: "Calibration",
        value: r.calibrated ? `${r.calibrationDbSpl.toFixed(1)} dB SPL` : "uncalibrated",
        title: r.calibrated
          ? "dB SPL of a full-scale sine"
          : "No calibration — the spectrum is relative (dBFS) while Tq is dB SPL",
      },
      { label: "FFT", value: `${r.fftSize}` },
      { label: "Frames", value: `${r.frames}` },
      { label: "Rate", value: `${r.sampleRate} Hz` },
    ];
  };

  return (
    <Show when={result()} fallback={<NoAudioState />}>
      <div class="analyzer-chart">
        <div class="analyzer-readouts">
          <For each={readouts()}>
            {(spec) => <Readout label={spec.label} value={spec.value} title={spec.title} />}
          </For>
        </div>
        <Show
          when={hasData()}
          fallback={
            <div class="analyzer-empty">
              Empty window — widen the analysis window or lower the FFT size.
            </div>
          }
        >
          <div class="analyzer-plot">
            <FrequencyChart
              zoom={levelZoom}
              data={data()}
              series={[
                {
                  label: "masked",
                  stroke: chartTheme().markerDownbeat,
                  width: 1,
                  alpha: 0.4,
                  paths: maskedBands,
                },
                {
                  label: "spectrum",
                  stroke: chartTheme().seriesMean,
                  width: 1.5,
                },
                {
                  label: "threshold in quiet",
                  stroke: chartTheme().seriesMin,
                  width: 1,
                  dash: [4, 3],
                },
                {
                  label: "masking threshold",
                  stroke: chartTheme().seriesMax,
                  width: 1,
                  dash: [4, 3],
                },
              ]}
              yWindow={100}
              yLabel={levelLabel()}
              yAnchor={SPECTRUM_COLUMN}
              legend={legend()}
              legendNote={legendNote()}
              plugins={maskerPlugins()}
              reference={smrReference(result())}
            />
          </div>
        </Show>
      </div>
    </Show>
  );
}
