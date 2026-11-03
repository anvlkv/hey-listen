import { SolidUplot } from "@dschz/solid-uplot";
import { cursor } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { Show, untrack } from "solid-js";
import Readout from "../analyzer/Readout";
import { createUplotZoom } from "../analyzer/uplotZoom";
import { timeTooltip } from "../analyzer/chartCommon";
import { compareMarkers } from "./peerPlugins";
import ComparePlot from "./ComparePlot";
import CompareTimeChart from "./CompareTimeChart";
import { compareSides, liveMarkers } from "./sides";
import { timeAxis, valueAxis } from "./axes";
import { bucketTimes } from "./waveform";
import { mergeSeries, toUplotData } from "./align";
import { clipSeries, displayTimes, type CompareTime } from "./time";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import type { AnalyzerId, WaveformResult } from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, WaveformDiffDto } from "../../state/compare/types";

/**
 * The **waveform** compare view (M25.A; relative alignment in M25.B).
 *
 * Both peak envelopes are drawn on the **relative** axis, starting at 0 at their own
 * window, with the reference shifted by the fine-tune offset. The delta samples the
 * other envelope at A's bucket times over the **common span** (the core does the
 * sampling); the view says *clipped to the shorter window* whenever the span does not
 * cover the displayed A side. A differing **grid** still draws the two separately.
 */
export default function CompareWaveform(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  /** The relative display transform (M25.B). */
  time: CompareTime;
}) {
  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<WaveformResult>(
    () => props.comparison,
    () => props.swapped,
  );
  /* eslint-enable solid/reactivity */
  const diff = (): WaveformDiffDto | null =>
    props.comparison.diff?.kind === "waveform" ? props.comparison.diff : null;
  const aligned = sides.aligned;

  const zoom = createUplotZoom(
    "time",
    untrack(() => props.time.axis()),
  );
  const Tooltip = timeTooltip((value) => value.toFixed(3));
  const markers = () =>
    compareMarkers(
      liveMarkers({
        live: props.live,
        swapped: () => props.swapped,
        time: props.time,
        axis: "time",
      }),
    );

  /** The overlaid peaks: each side mapped onto the relative axis and clipped. */
  const overlay = (): uPlot.AlignedData => {
    const a = sides.resultA();
    const b = sides.resultB();
    if (!a || !b) return [[], [], []];
    const end = props.time.extent();
    const aRel = clipSeries(
      displayTimes(bucketTimes(a.windowStart, a.duration, a.max.length), props.time.originA()),
      a.max,
      0,
      end,
    );
    const bRel = clipSeries(
      displayTimes(
        bucketTimes(b.windowStart, b.duration, b.max.length),
        props.time.originB(),
        props.time.shiftB(),
      ),
      b.max,
      0,
      end,
    );
    const merged = mergeSeries(aRel.times, aRel.values, bRel.times, bRel.values);
    return toUplotData(merged).slice(0, 3) as uPlot.AlignedData;
  };

  /** The signed delta, flipped after a swap (display only). */
  const deltaValues = () => {
    const values = diff()?.values;
    if (!values) return undefined;
    return props.swapped ? values.map((value) => -value) : values;
  };

  return (
    <div class="analyzer-chart compare-chart" data-testid="compare.waveform">
      <div class="analyzer-readouts">
        <Readout label="Δ mean" value={formatDelta(deltaValues())} />
        <Readout label="max |Δ|" value={formatPeak(deltaValues())} />
        <Readout label="Buckets" value={diff() ? `${diff()!.buckets}` : "—"} />
        <Readout label="Peak A" value={db(sides.resultA()?.peakDb)} />
        <Readout label="Peak B" value={db(sides.resultB()?.peakDb)} />
      </div>
      <Show when={aligned() && !diff()}>
        <div class="compare-banner" data-testid="compare.waveform.note">
          The shifted windows do not meet — adjust the fine-tune offset to compare them.
        </div>
      </Show>
      <Show when={diff() && props.time.clipped()}>
        <div class="compare-banner" data-testid="compare.waveform.note">
          The windows differ — the delta is clipped to the shorter window, and the other envelope is
          sampled at this side's bucket times.
        </div>
      </Show>

      <Show
        when={aligned() && sides.resultA() && sides.resultB()}
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
            <CompareTimeChart
              zoom={zoom}
              Tooltip={Tooltip}
              axis={() => props.time.axis()}
              markers={markers()}
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
              scales={{
                x: { time: false, range: () => [0, props.time.extent()] },
                y: { range: () => [-1.05, 1.05] },
              }}
              axes={[timeAxis(), valueAxis("amplitude")]}
            />
          </Show>
        </ComparePlot>
      </Show>
    </div>
  );
}

/** One side's own min/max envelope, used when the grids differ. */
function WaveSide(props: {
  label: string;
  color: string;
  result: WaveformResult | undefined;
  markers: () => ReturnType<typeof compareMarkers>;
}) {
  const data = (): uPlot.AlignedData => {
    const result = props.result;
    if (!result || result.max.length === 0) return [[], []];
    // Each side's own plot starts at its window, so the origin cancels out.
    const times = bucketTimes(result.windowStart, result.duration, result.max.length);
    const rel = displayTimes(times, result.windowStart);
    return [rel, result.max, result.min];
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
