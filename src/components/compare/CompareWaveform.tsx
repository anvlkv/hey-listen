import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { Show } from "solid-js";
import Readout from "../analyzer/Readout";
import { createUplotZoom } from "../analyzer/uplotZoom";
import { mirrorCursor, syncView } from "../analyzer/syncPlugins";
import { timeTooltip } from "../analyzer/chartCommon";
import { compareMarkers } from "./peerPlugins";
import ComparePlot from "./ComparePlot";
import { compareSides, liveMarkers } from "./sides";
import { timeAxis, valueAxis } from "./axes";
import { bucketTimes } from "./waveform";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import type { AnalyzerId, WaveformResult } from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, Span, WaveformDiffDto } from "../../state/compare/types";

/**
 * The **waveform** compare view (M25.A).
 *
 * The upper envelopes are overlaid on one time axis **only when the two windows are
 * identical**, because bucket *i* then covers the same absolute-time span on both sides
 * (the core's `WaveformDelta` encodes exactly that rule: `buckets > 0`). A differing
 * window draws each project's min/max envelope separately instead — a bucket of one
 * window has no counterpart in the other, so there is no envelope delta.
 */
export default function CompareWaveform(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  bWindow: () => Span | null;
}) {
  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<WaveformResult>(
    () => props.comparison,
    () => props.swapped,
  );
  /* eslint-enable solid/reactivity */
  const diff = (): WaveformDiffDto | null =>
    props.comparison.diff?.kind === "waveform" ? props.comparison.diff : null;
  /** The core only computes a delta when both windows are identical. */
  const identical = () => (diff()?.buckets ?? 0) > 0;

  const zoom = createUplotZoom("time");
  const Tooltip = timeTooltip((value) => value.toFixed(3));
  const markers = () =>
    compareMarkers(
      liveMarkers({
        live: props.live,
        swapped: () => props.swapped,
        window: props.bWindow,
        axis: "time",
      }),
    );

  /** The overlaid peaks: one shared bucket grid (identical windows only). */
  const overlay = (): uPlot.AlignedData => {
    const a = sides.resultA();
    const b = sides.resultB();
    if (!a || !b) return [[], [], []];
    const times = bucketTimes(a.windowStart, a.duration, a.max.length);
    return [times, a.max, b.max];
  };

  return (
    <div class="analyzer-chart compare-chart" data-testid="compare.waveform">
      <div class="analyzer-readouts">
        <Readout label="Δ mean" value={formatDelta(diff()?.values)} />
        <Readout label="max |Δ|" value={formatPeak(diff()?.values)} />
        <Readout label="Buckets" value={diff() ? `${diff()!.buckets}` : "—"} />
        <Readout label="Peak A" value={db(sides.resultA()?.peakDb)} />
        <Readout label="Peak B" value={db(sides.resultB()?.peakDb)} />
      </div>
      <Show when={diff() && !identical()}>
        <div class="compare-banner" data-testid="compare.waveform.note">
          The analysis windows differ — bucket <em>i</em> covers a different span on each side, so
          there is no envelope delta.
        </div>
      </Show>

      <Show
        when={identical()}
        fallback={
          <div class="compare-side-by-side" data-testid="compare.waveform.side">
            <WaveSide
              label={props.swapped ? "B" : "A"}
              color={chartTheme().compareA}
              result={sides.resultA()}
              markers={markers}
            />
            <WaveSide
              label={props.swapped ? "A" : "B"}
              color={chartTheme().compareB}
              result={sides.resultB()}
              markers={markers}
            />
          </div>
        }
      >
        <ComparePlot zoom={zoom}>
          <Show when={activeThemeId()} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[
                cursor(),
                tooltip(Tooltip),
                mirrorCursor("time"),
                syncView("time"),
                markers(),
              ]}
              onCreate={zoom.onReady}
              data={overlay()}
              series={[
                {},
                {
                  label: `${props.swapped ? "B" : "A"} peak`,
                  stroke: chartTheme().compareA,
                  width: 1,
                  fill: chartTheme().waveFill,
                },
                {
                  label: `${props.swapped ? "A" : "B"} peak`,
                  stroke: chartTheme().compareB,
                  width: 1,
                },
              ]}
              scales={{ x: { time: false }, y: { range: () => [-1.05, 1.05] } }}
              axes={[timeAxis(), valueAxis("amplitude")]}
            />
          </Show>
        </ComparePlot>
      </Show>
    </div>
  );
}

/** One side's own min/max envelope, used when the windows differ. */
function WaveSide(props: {
  label: string;
  color: string;
  result: WaveformResult | undefined;
  markers: () => ReturnType<typeof compareMarkers>;
}) {
  const data = (): uPlot.AlignedData => {
    const result = props.result;
    if (!result || result.max.length === 0) return [[], []];
    const times = bucketTimes(result.windowStart, result.duration, result.max.length);
    return [times, result.max, result.min];
  };
  return (
    <div class="compare-side">
      <div class="compare-side-label" style={{ color: props.color }}>
        {props.label}
      </div>
      <Show
        when={props.result && props.result.max.length > 0}
        fallback={<div class="analyzer-empty">This project has no waveform for the window.</div>}
      >
        <Show when={activeThemeId()} keyed>
          <SolidUplot
            autoResize
            pluginBus={analyzerBus}
            plugins={[cursor(), props.markers()]}
            data={data()}
            series={[
              {},
              { label: "Max", stroke: props.color, width: 1 },
              { label: "Min", stroke: props.color, width: 1 },
            ]}
            bands={[{ series: [1, 2], fill: chartTheme().waveFill }]}
            scales={{ x: { time: false } }}
            axes={[timeAxis(), valueAxis("amplitude")]}
          />
        </Show>
      </Show>
    </div>
  );
}

function mean(values: number[] | undefined): number | null {
  if (!values || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxAbs(values: number[] | undefined): number | null {
  if (!values || values.length === 0) return null;
  return values.reduce((best, value) => Math.max(best, Math.abs(value)), 0);
}

function formatDelta(values: number[] | undefined): string {
  const value = mean(values);
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

function formatPeak(values: number[] | undefined): string {
  const value = maxAbs(values);
  return value == null ? "—" : value.toFixed(3);
}

function db(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)} dBFS`;
}
