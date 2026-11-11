import uPlot from "uplot";
import { For, Show } from "solid-js";
import Readout from "./Readout";
import FrequencyChart from "./FrequencyChart";
import MaskingSmrPanel from "./MaskingSmrPanel";
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
 * those bins; the builder reads the threshold curve (series 3) for the other end.
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
  const threshold = u.data[3];
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
 * Masking view (M30, M36): the averaged spectrum with the threshold in quiet `Tq`
 * and the global masking threshold `Tg` on one **level** panel, and the
 * signal-to-mask ratio on a separate, aligned **SMR** panel (a different quantity
 * must not share one y-scale). Masked bins (negative SMR) are drawn as bands between
 * the level and `Tg`.
 *
 * The level axis is `level (dB SPL)` only when the run is calibrated; otherwise it is
 * `relative level (dB)` and the legend says `Tq` is dB SPL — the two are not directly
 * comparable without calibration. Zoom and cursor are synced with the other frequency
 * charts on the `"freq"` group, and the two panels share that sync.
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
  const smrZoom = createUplotZoom("freq");

  // Only the level panel provides the tab's PNG export.
  useUplotImage(() => props.id, levelZoom.instance);

  const masked = (r: MaskingResult) => r.smrDb.map((smr, i) => (smr < 0 ? r.spectrumDb[i] : null));

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
    return [r.freqs, r.spectrumDb, r.thresholdQuietDb, r.globalMaskDb, masked(r)];
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
      { label: "masked (SMR < 0)", color: chartTheme().markerDownbeat },
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
          <div class="analyzer-plot masking-level">
            <FrequencyChart
              zoom={levelZoom}
              data={data()}
              series={[
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
                {
                  label: "masked",
                  stroke: chartTheme().markerDownbeat,
                  width: 3,
                  paths: maskedBands,
                },
              ]}
              yWindow={100}
              yLabel={levelLabel()}
              legend={legend()}
              legendNote={legendNote()}
              plugins={maskerPlugins()}
            />
          </div>
          <div class="analyzer-plot masking-smr" onWheel={smrZoom.wheel}>
            <MaskingSmrPanel
              zoom={smrZoom}
              freqs={result()?.freqs ?? []}
              smrDb={result()?.smrDb ?? []}
            />
          </div>
        </Show>
      </div>
    </Show>
  );
}
