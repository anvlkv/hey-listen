import { For, Show } from "solid-js";
import Readout from "./Readout";
import ReframeMenu from "./ReframeMenu";
import TimeSeriesChart from "./TimeSeriesChart";
import { useTimeChart, timeSeriesData } from "./timeChart";
import { NoAudioState } from "./chartCommon";
import { coverage, seriesReadouts } from "./readouts";
import {
  analyzerById,
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type PitchResult,
  type SeriesResult,
  type SeriesView as SeriesViewConfig,
} from "../../state/analyzer";

const isPitch = (id: AnalyzerId) => id.startsWith("pitch");

/** The voiced share of a pitch result (server-provided; falls back to the values). */
function voicedShare(result: SeriesResult): number {
  return (result as Partial<PitchResult>).voicedFraction ?? coverage(result.values);
}

/** The f0 window the detector actually searched, or `null` for a non-pitch result. */
function effectivePitchRange(result: SeriesResult): string | null {
  const pitch = result as Partial<PitchResult>;
  if (pitch.effectiveMinF0Hz == null || pitch.effectiveMaxF0Hz == null) return null;
  return `${Math.round(pitch.effectiveMinF0Hz)}–${Math.round(pitch.effectiveMaxF0Hz)} Hz`;
}

/** Empty-state copy for a pitch chart: name the range that was actually searched. */
function pitchEmptyHint(id: AnalyzerId, result: SeriesResult): string {
  const range = effectivePitchRange(result) ?? "the detector's range";
  const advice =
    id === "pitchPyin"
      ? "pYIN only searches that fixed window — use YIN or autocorrelation above 2 kHz."
      : "Adjust Min f0 / Max f0 in the tool params to widen it.";
  return (
    "No voiced frames — the signal may be unpitched or polyphonic, or its fundamental " +
    `may lie outside ${range}. ${advice}`
  );
}

/**
 * Generic time-series view (M5): plots a tool's one-value-per-frame result against
 * time. The y-axis label / formatter and point style come from the tool's registry
 * entry, so every scalar-over-time tool shares this chart. Zoom and cursor are
 * synced with the other analyzer tabs on the `"time"` group. See
 * `docs/analysis-tools.md`.
 */
export default function SeriesView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const view = () => analyzerById(props.id).view as SeriesViewConfig;
  const result = () => props.analysis.result() as SeriesResult | null;
  const { zoom, menu, setMenu, openMenu } = useTimeChart(() => props.id);

  const data = (): [number[], (number | null)[]] => timeSeriesData(result(), (r) => r.values);

  /** A chart needs at least two frames and some non-gap values. */
  const plottable = () => {
    const r = result();
    return !!r && r.times.length >= 2 && r.values.some((value) => value != null);
  };

  /** Right-click: reframe the timeline window from the time under the pointer. */

  return (
    <Show when={result()} fallback={<NoAudioState />}>
      {(r) => (
        <div class="analyzer-chart">
          <div class="analyzer-readouts">
            <For each={seriesReadouts(r(), view().formatY)}>
              {(spec) => <Readout label={spec.label} value={spec.value} title={spec.title} />}
            </For>
            <Show when={isPitch(props.id)}>
              <Readout
                label="Voiced"
                value={`${(voicedShare(r()) * 100).toFixed(0)}%`}
                title="Share of analysed frames with a detected pitch"
              />
              <Show when={effectivePitchRange(r())}>
                {(range) => (
                  <Readout
                    label="f0 range"
                    value={range()}
                    title="The fundamental-frequency window the detector actually searched"
                  />
                )}
              </Show>
            </Show>
          </div>
          <div class="analyzer-plot" onWheel={zoom.wheel} onContextMenu={openMenu}>
            <Show
              when={plottable()}
              fallback={
                <div class="analyzer-empty">
                  {isPitch(props.id)
                    ? pitchEmptyHint(props.id, r())
                    : "No values in this window — widen the analysis window or change the FFT size."}
                </div>
              }
            >
              <TimeSeriesChart
                id={props.id}
                zoom={zoom}
                data={data()}
                yLabel={view().yLabel}
                formatY={view().formatY}
                seriesStyle={view().style}
                points={view().points}
                yScale={view().yScale}
                yRange={view().yRange}
                reference={view().reference}
                semitoneGrid={view().semitoneGrid}
                frequencyY={isPitch(props.id)}
              />
            </Show>
          </div>
          <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
        </div>
      )}
    </Show>
  );
}
