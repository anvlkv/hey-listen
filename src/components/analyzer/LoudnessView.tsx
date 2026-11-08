import { For, Show } from "solid-js";
import Readout from "./Readout";
import ReframeMenu from "./ReframeMenu";
import TimeSeriesChart from "./TimeSeriesChart";
import { useTimeChart, timeSeriesData } from "./timeChart";
import { NoAudioState } from "./chartCommon";
import {
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type LoudnessResult,
} from "../../state/analyzer";

const Y_LABEL = "loudness (sone)";
const sones = (value: number) => `${value.toFixed(3)} sone`;

/** The finite, non-gap values of a track. */
function present(values: (number | null)[]): number[] {
  return values.filter((value): value is number => value != null && Number.isFinite(value));
}

/** The loudness exceeded 5% of the time (the 95th percentile). */
function n5(values: (number | null)[]): number {
  const sorted = present(values).sort((a, b) => b - a);
  return sorted[Math.floor(0.05 * (sorted.length - 1))] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** The conventional sone → phon curve, mirroring the engine. */
function soneToPhon(sone: number): number {
  if (!Number.isFinite(sone) || sone <= 0) return 0;
  return sone < 1 ? 40 * Math.pow(sone, 0.35) : 40 + 10 * Math.log2(sone);
}

/**
 * Loudness view (M27): plots the Moore–Glasberg sone curve over time with N5 /
 * mean / max and calibration readouts. Zoom and cursor are synced with the other
 * analyzer tabs on the `"time"` group.
 */
export default function LoudnessView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const result = () => props.analysis.result() as LoudnessResult | null;
  const { zoom, menu, setMenu, openMenu } = useTimeChart(() => props.id);

  const data = (): [number[], (number | null)[]] => timeSeriesData(result(), (r) => r.loudnessSone);

  /** A chart needs at least two frames and some non-gap values. */
  const plottable = () => {
    const r = result();
    return !!r && r.times.length >= 2 && r.loudnessSone.some((value) => value != null);
  };

  const readouts = () => {
    const r = result();
    if (!r) return [];
    const values = present(r.loudnessSone);
    const peak = n5(r.loudnessSone);
    return [
      {
        label: "N5",
        value: sones(peak),
        title: "Loudness exceeded 95% of the time",
      },
      { label: "Mean", value: sones(mean(values)), title: "Mean loudness over the window" },
      {
        label: "Max",
        value: sones(values.length ? Math.max(...values) : 0),
        title: "Loudest analysed frame",
      },
      {
        label: "N5 level",
        value: `${soneToPhon(peak).toFixed(1)} phon`,
        title: "Loudness level of the N5",
      },
      {
        label: "Calibration",
        value: r.calibrated ? `${r.calibrationDbSpl.toFixed(1)} dB SPL` : "uncalibrated",
        title: r.calibrated
          ? "dB SPL of a full-scale sine"
          : "No calibration — the sones are relative",
      },
    ];
  };

  /** Right-click: reframe the timeline window from the time under the pointer. */

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
          <div class="analyzer-plot" onWheel={zoom.wheel} onContextMenu={openMenu}>
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
                yLabel={Y_LABEL}
                formatY={sones}
                seriesStyle="area"
              />
            </Show>
          </div>
          <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
        </div>
      )}
    </Show>
  );
}
