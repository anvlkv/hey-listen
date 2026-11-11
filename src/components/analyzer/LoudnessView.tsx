import { For, Show } from "solid-js";
import Readout from "./Readout";
import ReframeMenu from "./ReframeMenu";
import TimeSeriesChart, { type SecondaryTrack } from "./TimeSeriesChart";
import ChartLegend from "./chartLegend";
import { useTimeChart, timeSeriesData } from "./timeChart";
import { NoAudioState, UplotChartPlot } from "./chartCommon";
import { mean, percentile, present } from "../../lib/percentiles";
import { chartTheme } from "../../state/themes";
import {
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type LoudnessResult,
} from "../../state/analyzer";

const sones = (value: number) => `${value.toFixed(3)} sone`;
const phons = (value: number) => `${value.toFixed(1)} phon`;

/** A track's median level, or `null` when the payload is absent or off the frame grid. */
function trackMedian(values: (number | null)[] | undefined, frames: number): number | null {
  if (!values || values.length !== frames) return null;
  const finite = present(values);
  return finite.length === 0 ? null : percentile(finite, 0.5);
}

/** The conventional sone → phon curve, mirroring the engine. */
function soneToPhon(sone: number): number {
  if (!Number.isFinite(sone) || sone <= 0) return 0;
  return sone < 1 ? 40 * Math.pow(sone, 0.35) : 40 + 10 * Math.log2(sone);
}

/**
 * Loudness view (M27, M36): the Moore–Glasberg sone curve with its phon level on a
 * second, labelled axis, plus N5 / N50 / N95, mean and max readouts and the model /
 * calibration the payload reports.
 *
 * The percentiles are **order statistics of the same sone track**: N5 is the level
 * exceeded 5% of the time (the 95th percentile), N50 the median, N95 the level
 * exceeded 95% of the time (the 5th percentile) — see `lib/percentiles.ts`.
 *
 * The payload's broadband **RMS** (and, when calibrated, absolute **SPL**) levels are
 * reported as median readouts and in the legend note rather than drawn on the
 * sone/phon chart: a third y-scale would make two unrelated quantities look
 * comparable. Their per-frame tracks stay in the payload for the timeline/export.
 */
export default function LoudnessView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const result = () => props.analysis.result() as LoudnessResult | null;
  const { zoom, menu, setMenu, openMenu } = useTimeChart(() => props.id);

  const data = (): [number[], (number | null)[]] => timeSeriesData(result(), (r) => r.loudnessSone);

  /** The phon track on its own right-hand axis (never stacked onto the sone scale). */
  const phonTrack = (): SecondaryTrack => {
    const r = result();
    const values: (number | null)[] =
      r && r.loudnessPhon.length === r.loudnessSone.length
        ? r.loudnessPhon
        : (r?.loudnessSone ?? []).map(() => null);
    return {
      label: "loudness level",
      values,
      yLabel: "loudness level (phon)",
      format: phons,
      stroke: chartTheme().seriesMax,
    };
  };

  /** A chart needs at least two frames and some non-gap values. */
  const plottable = () => {
    const r = result();
    return !!r && r.times.length >= 2 && r.loudnessSone.some((value) => value != null);
  };

  /** The median broadband RMS level (dBFS), when the payload carries the track. */
  const rmsMedian = (): number | null => {
    const r = result();
    return r ? trackMedian(r.frameRmsDb, r.times.length) : null;
  };

  /** The median absolute level (dB SPL) — present only for a calibrated run. */
  const splMedian = (): number | null => {
    const r = result();
    return r ? trackMedian(r.frameSplDb, r.times.length) : null;
  };

  /** The legend's trailing fact: the model, plus the broadband level the payload reports. */
  const legendNote = (): string | undefined => {
    const r = result();
    if (!r) return undefined;
    const rms = rmsMedian();
    const spl = splMedian();
    const level =
      rms == null
        ? undefined
        : spl == null
          ? `RMS ${rms.toFixed(1)} dBFS (median)`
          : `RMS ${rms.toFixed(1)} dBFS · SPL ${spl.toFixed(1)} dB SPL (median)`;
    return [r.model, level].filter(Boolean).join(" · ") || undefined;
  };

  const readouts = () => {
    const r = result();
    if (!r) return [];
    const values = present(r.loudnessSone);
    const n5 = percentile(values, 0.95);
    const rms = rmsMedian();
    const spl = splMedian();
    return [
      {
        label: "N5",
        value: sones(n5),
        title: "Loudness exceeded 5% of the time — the 95th percentile of the track",
      },
      {
        label: "N50",
        value: sones(percentile(values, 0.5)),
        title: "Median loudness — the 50th percentile of the track",
      },
      {
        label: "N95",
        value: sones(percentile(values, 0.05)),
        title: "Loudness exceeded 95% of the time — the 5th percentile of the track",
      },
      { label: "Mean", value: sones(mean(values)), title: "Mean loudness over the window" },
      {
        label: "Max",
        value: sones(values.length ? Math.max(...values) : 0),
        title: "Loudest analysed frame",
      },
      {
        label: "N5 level",
        value: `${soneToPhon(n5).toFixed(1)} phon`,
        title: "Loudness level of the N5",
      },
      ...(rms != null
        ? [
            {
              label: "RMS",
              value: `${rms.toFixed(1)} dBFS`,
              title:
                "Median per-frame RMS level over the window — a broadband level for comparison, not a perceptual scale",
            },
          ]
        : []),
      ...(spl != null
        ? [
            {
              label: "SPL",
              value: `${spl.toFixed(1)} dB SPL`,
              title:
                "Median per-frame absolute RMS level — present only when the run is calibrated",
            },
          ]
        : []),
      {
        label: "Model",
        value: [r.model, r.standard && `(${r.standard})`].filter(Boolean).join(" ") || "—",
        title: "The loudness model this run implements, as the result payload reports it",
      },
      {
        label: "Calibration",
        value: r.calibrated ? `${r.calibrationDbSpl.toFixed(1)} dB SPL` : "relative / uncalibrated",
        title: r.calibrated
          ? "dB SPL of a full-scale sine — the sones and phons are absolute"
          : "No calibration — the sones and phons are relative",
      },
    ];
  };

  return (
    <Show when={result()} fallback={<NoAudioState />}>
      {(r) => (
        <div class="analyzer-chart">
          <div class="analyzer-readouts">
            <For each={readouts()}>
              {(spec) => <Readout label={spec.label} value={spec.value} title={spec.title} />}
            </For>
            <Readout
              label="Frames"
              value={`${r().times.length}`}
              title="Analysed STFT frames in the window"
            />
          </div>
          <UplotChartPlot zoom={zoom} onWheel={zoom.wheel} onContextMenu={openMenu}>
            <Show
              when={plottable()}
              fallback={
                <div class="analyzer-empty">
                  No loudness values in this window — widen the analysis window or change the FFT
                  size.
                </div>
              }
            >
              <TimeSeriesChart
                id={props.id}
                zoom={zoom}
                data={data()}
                yLabel="loudness (sone)"
                formatY={sones}
                sampling="block"
                fill
                secondary={phonTrack()}
              />
            </Show>
          </UplotChartPlot>
          <ChartLegend
            entries={[
              { label: "loudness (sone)", color: chartTheme().series, kind: "fill" },
              { label: "loudness level (phon)", color: chartTheme().seriesMax },
            ]}
            note={legendNote()}
          />
          <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
        </div>
      )}
    </Show>
  );
}
