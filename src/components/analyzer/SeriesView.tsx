import { For, Show } from "solid-js";
import Readout from "./Readout";
import ReframeMenu from "./ReframeMenu";
import TimeSeriesChart, { type SecondaryTrack } from "./TimeSeriesChart";
import ChartLegend, { type ChartLegendEntry } from "./chartLegend";
import ToolLink from "./ToolLink";
import { useTimeChart, timeSeriesData } from "./timeChart";
import { NoAudioState, UplotChartPlot } from "./chartCommon";
import { coverage, seriesReadouts } from "./readouts";
import { percentile, present } from "../../lib/percentiles";
import { chartTheme } from "../../state/themes";
import {
  analyzerById,
  toolOptions,
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type PitchResult,
  type SeriesResult,
  type SeriesView as SeriesViewConfig,
} from "../../state/analyzer";

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

/** The tooltip / axis name of the confidence track the descriptor declares. */
function confidenceLabel(kind: "voicing" | "periodicity"): string {
  return kind === "voicing" ? "voicing probability" : "periodicity";
}

/** How a track's samples relate to time, for the legend's trailing fact. */
const SAMPLING_NOTE: Record<NonNullable<SeriesViewConfig["sampling"]>, string> = {
  "frame-centre": "one sample per frame centre",
  block: "block samples",
  step: "steps at each sample",
};

/**
 * Generic time-series view (M5): plots a tool's one-value-per-frame result against
 * time. The y-axis label / formatter, the sampling model and the fill come from the
 * tool's registry entry, so every scalar-over-time tool shares this chart. Zoom and
 * cursor are synced with the other analyzer tabs on the `"time"` group. See
 * `docs/analysis-tools.md`.
 *
 * A **pitch** track is auditable (M36): its registry entry declares
 * `view.pitchDisplay`, so the per-frame confidence is drawn on its own right-hand
 * scale with a guide rule, the frequency axis names notes, and the legend says what
 * each mark is. The branch is descriptor data — never an id prefix.
 */
export default function SeriesView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const view = () => analyzerById(props.id).view as SeriesViewConfig;
  const pitch = () => view().pitchDisplay;
  const result = () => props.analysis.result() as SeriesResult | null;
  const { zoom, menu, setMenu, openMenu } = useTimeChart(() => props.id);

  const data = (): [number[], (number | null)[]] => timeSeriesData(result(), (r) => r.values);

  /** A chart needs at least two frames and some non-gap values. */
  const plottable = () => {
    const r = result();
    return !!r && r.times.length >= 2 && r.values.some((value) => value != null);
  };

  /** The per-frame confidence track (`PitchResult.confidence`), on a fixed 0…1 scale. */
  const confidenceTrack = (): SecondaryTrack | undefined => {
    const display = pitch();
    if (!display || display.confidence === "none") return undefined;
    const r = result();
    const confidence = (r as Partial<PitchResult> | null)?.confidence;
    const values: (number | null)[] =
      r && confidence && confidence.length === r.values.length
        ? confidence
        : (r?.values ?? []).map(() => null);
    return {
      label: confidenceLabel(display.confidence),
      values,
      yLabel: "confidence (0–1)",
      format: (value) => value.toFixed(2),
      stroke: chartTheme().seriesMax,
      yRange: [0, 1],
      points: true,
    };
  };

  /** The display guide on the confidence scale (never the detector's own threshold). */
  const confidenceThreshold = () => {
    const display = pitch();
    if (!display || display.confidence === "none") return undefined;
    const threshold = display.confidenceThreshold;
    return threshold == null
      ? undefined
      : [
          {
            value: threshold,
            label: `confidence ${threshold.toFixed(2)} (guide)`,
            scale: "y2",
          },
        ];
  };

  /** The median confidence over voiced frames — a reading aid, not a verdict. */
  const confidenceMedian = (): number | null => {
    const display = pitch();
    const values = (result() as Partial<PitchResult> | null)?.confidence;
    if (!display || display.confidence === "none" || !values) return null;
    const voiced = present(values);
    return voiced.length === 0 ? null : percentile(voiced, 0.5);
  };

  /** A pitch chart's marks: f0, the reliability track, and its display guide. */
  const pitchLegend = (): ChartLegendEntry[] => {
    const display = pitch();
    if (!display) return [];
    const rows: ChartLegendEntry[] = [{ label: "f0", color: chartTheme().series }];
    if (display.confidence !== "none") {
      rows.push({ label: confidenceLabel(display.confidence), color: chartTheme().seriesMax });
    }
    if (display.confidenceThreshold != null && display.confidence !== "none") {
      rows.push({
        label: `confidence guide ${display.confidenceThreshold.toFixed(2)}`,
        color: chartTheme().reference,
        kind: "dashed",
      });
    }
    return rows;
  };

  /** An ordinary feature track's marks: its line, and the sampling model beside it. */
  const featureLegend = (): ChartLegendEntry[] => [
    { label: view().yLabel, color: chartTheme().series, kind: view().fill ? "fill" : "line" },
  ];

  /** The legend's trailing fact: what a bounded scale means, and how it was sampled. */
  const legendNote = (): string | undefined =>
    [view().boundedMeaning, view().sampling ? SAMPLING_NOTE[view().sampling!] : undefined]
      .filter(Boolean)
      .join(" · ") || undefined;

  return (
    <Show when={result()} fallback={<NoAudioState />}>
      {(r) => (
        <div class="analyzer-chart">
          <div class="analyzer-readouts">
            <For each={seriesReadouts(r(), view().formatY)}>
              {(spec) => <Readout label={spec.label} value={spec.value} title={spec.title} />}
            </For>
            <Show when={pitch()}>
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
              <Show when={confidenceMedian() != null}>
                <Readout
                  label="Confidence"
                  value={`${confidenceMedian()!.toFixed(2)} median`}
                  title="Median per-frame confidence over voiced frames. Per-frame only — candidate frequencies and octave-ambiguity flags are not provided by the engine."
                />
              </Show>
            </Show>
            <Show when={view().context}>
              {(context) => (
                <Readout
                  label={context().label}
                  value={context().format(toolOptions[props.id]?.[context().option] ?? 0)}
                  title={context().title}
                />
              )}
            </Show>
            <Show when={view().supportingTool}>
              {(tool) => (
                <ToolLink
                  id={tool()}
                  title={`Open ${analyzerById(tool()).title} for the underlying data this track is derived from (same window and cursor)`}
                />
              )}
            </Show>
          </div>
          <UplotChartPlot zoom={zoom} onWheel={zoom.wheel} onContextMenu={openMenu}>
            <Show
              when={plottable()}
              fallback={
                <div class="analyzer-empty">
                  {pitch()
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
                sampling={view().sampling}
                fill={view().fill}
                points={view().points}
                yScale={view().yScale}
                yRange={view().yRange}
                reference={view().reference}
                referenceLines={confidenceThreshold()}
                semitoneGrid={view().semitoneGrid}
                frequencyY={pitch()?.noteLabels ?? false}
                yAxisSize={pitch() ? 64 : undefined}
                secondary={confidenceTrack()}
              />
            </Show>
          </UplotChartPlot>
          <Show when={plottable()}>
            <ChartLegend
              entries={pitch() ? pitchLegend() : featureLegend()}
              note={pitch() ? "per-frame confidence" : legendNote()}
            />
          </Show>
          <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
        </div>
      )}
    </Show>
  );
}
