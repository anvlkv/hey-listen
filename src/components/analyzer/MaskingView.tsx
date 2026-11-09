import uPlot from "uplot";
import { For, Show } from "solid-js";
import Readout from "./Readout";
import FrequencyChart from "./FrequencyChart";
import { createUplotZoom } from "./uplotZoom";
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
 * Masking view (M30): the averaged spectrum with the threshold in quiet `Tq` and
 * the global masking threshold `Tg` overlaid, and masked bins (negative SMR) drawn
 * as bands between the level and `Tg`. Zoom and cursor are synced with the other
 * frequency charts on the `"freq"` group.
 */
export default function MaskingView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const result = () => props.analysis.result() as MaskingResult | null;
  const zoom = createUplotZoom("freq");

  useUplotImage(() => props.id, zoom.instance);

  const masked = (r: MaskingResult) => r.smrDb.map((smr, i) => (smr < 0 ? r.spectrumDb[i] : null));

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

  const readouts = () => {
    const r = result();
    if (!r) return [];
    const smr = r.smrDb.filter((value) => Number.isFinite(value));
    const min = smr.length ? Math.min(...smr) : 0;
    const max = smr.length ? Math.max(...smr) : 0;
    const maskedBins = smr.filter((value) => value < 0).length;
    return [
      {
        label: "SMR",
        value: `${min.toFixed(1)} … ${max.toFixed(1)} dB`,
        title: "Signal-to-mask ratio range — positive means above the estimated threshold",
      },
      {
        label: "Masked",
        value: `${maskedBins} / ${smr.length} bins`,
        title: "Bins whose level sits under the global masking threshold",
      },
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
        <div class="analyzer-plot" onWheel={zoom.wheel}>
          <Show
            when={hasData()}
            fallback={
              <div class="analyzer-empty">
                Empty window — widen the analysis window or lower the FFT size.
              </div>
            }
          >
            <FrequencyChart
              zoom={zoom}
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
            />
          </Show>
        </div>
      </div>
    </Show>
  );
}
