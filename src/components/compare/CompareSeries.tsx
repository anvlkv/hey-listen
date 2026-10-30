import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { createMemo, createSignal, Show, untrack } from "solid-js";
import Readout from "../analyzer/Readout";
import { createUplotZoom } from "../analyzer/uplotZoom";
import { mirrorCursor, syncView } from "../analyzer/syncPlugins";
import { timeTooltip } from "../analyzer/chartCommon";
import { paddedYRange } from "../analyzer/range";
import { compareMarkers } from "./peerPlugins";
import ComparePlot from "./ComparePlot";
import { timeAxis, valueAxis } from "./axes";
import { compareSides, liveMarkers } from "./sides";
import { mergeSeries, toUplotData, type MergedSeries } from "./align";
import { activeThemeId, chartTheme } from "../../state/themes";
import { analyzerBus } from "../../state/chartSync";
import {
  analyzerById,
  type AnalyzerId,
  type SeriesResult,
  type SeriesView as SeriesViewConfig,
} from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, SeriesDiffDto, Span } from "../../state/compare/types";

export interface CompareSeriesProps {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  /** The reference's analysis window (the band the chart draws). */
  bWindow: () => Span | null;
}

/** A log-scale y-range with headroom, clamped so it never reaches 0. */
function logYRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 0.1;
  const hi = max > lo ? max : lo * 10;
  return [lo / 1.15, hi * 1.15];
}

/**
 * The **series** compare chart (M25): A and B overlaid on one absolute-time axis with
 * an optional Δ line, or two side-by-side plots when the grids differ (no
 * interpolation). B's window, cursor and playhead are drawn by [`compareMarkers`];
 * the chart joins A's `time` sync group.
 */
export default function CompareSeries(props: CompareSeriesProps) {
  const view = () => analyzerById(props.tool).view as SeriesViewConfig;
  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<SeriesResult>(
    () => props.comparison,
    () => props.swapped,
  );
  /* eslint-enable solid/reactivity */
  const diff = (): SeriesDiffDto | null =>
    props.comparison.diff?.kind === "series" ? props.comparison.diff : null;
  const [showDelta, setShowDelta] = createSignal(false);

  const aligned = sides.aligned;

  const merged = createMemo(() => {
    const a = sides.resultA();
    const b = sides.resultB();
    if (!a || !b) return null;
    const d = diff();
    const values = d?.values ?? [];
    // Swap A/B flips the sign of the core's `B − A` delta (display only).
    const deltaValues = props.swapped ? values.map((v) => (v == null ? null : -v)) : values;
    return mergeSeries(a.times, a.values, b.times, b.values, d?.times ?? [], deltaValues);
  });

  const zoom = createUplotZoom("time");
  const Tooltip = timeTooltip(untrack(() => view().formatY));
  const markers = () =>
    compareMarkers(
      liveMarkers({
        live: props.live,
        swapped: () => props.swapped,
        window: props.bWindow,
        axis: "time",
      }),
    );

  const yScale = (): uPlot.Scale =>
    view().yScale === "log"
      ? { distr: 3, log: 10, range: logYRange }
      : { range: view().yRange ? () => view().yRange! : paddedYRange };

  /** The chart's columns: the Δ column only exists while the Δ line is on. */
  const chartData = (merged: MergedSeries): uPlot.AlignedData => {
    const data = toUplotData(merged);
    return (showDelta() ? data : data.slice(0, 3)) as uPlot.AlignedData;
  };

  return (
    <div class="analyzer-chart compare-chart">
      <div class="analyzer-readouts">
        <Readout label="Δ mean" value={formatDelta(diff()?.stats.mean)} />
        <Readout label="max |Δ|" value={formatDelta(diff()?.stats.maxAbs)} />
        <Readout label="Pairs" value={diff() ? `${diff()!.stats.matched}` : "—"} />
        <Readout
          label="r"
          value={diff()?.stats.correlation != null ? diff()!.stats.correlation!.toFixed(3) : "—"}
          title="Pearson correlation between A and B over the matched frames"
        />
        <Show when={diff()}>
          <button
            type="button"
            class={`compare-toggle ${showDelta() ? "on" : ""}`}
            aria-pressed={showDelta()}
            onClick={() => setShowDelta((on) => !on)}
          >
            Δ line
          </button>
        </Show>
      </div>

      <Show
        when={aligned() && merged()}
        fallback={
          <div class="compare-side-by-side">
            <SidePlot
              label={props.swapped ? "B" : "A"}
              color={chartTheme().compareA}
              series={sides.resultA()}
              view={view()}
              scale={yScale()}
              markers={markers}
            />
            <SidePlot
              label={props.swapped ? "A" : "B"}
              color={chartTheme().compareB}
              series={sides.resultB()}
              view={view()}
              scale={yScale()}
              markers={markers}
            />
          </div>
        }
      >
        {(data) => (
          <ComparePlot zoom={zoom}>
            <Show when={`${activeThemeId()}|${showDelta()}`} keyed>
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
                data={chartData(data())}
                series={[
                  {},
                  {
                    label: props.swapped ? "B" : "A",
                    stroke: chartTheme().compareA,
                    width: 1.4,
                  },
                  {
                    label: props.swapped ? "A" : "B",
                    stroke: chartTheme().compareB,
                    width: 1.4,
                  },
                  ...(showDelta()
                    ? [
                        {
                          label: props.swapped ? "Δ (A − B)" : "Δ (B − A)",
                          stroke: chartTheme().compareDelta,
                          width: 1,
                          dash: [5, 3],
                        },
                      ]
                    : []),
                ]}
                scales={{ x: { time: false }, y: yScale() }}
                axes={[timeAxis(), valueAxis(view().yLabel)]}
              />
            </Show>
          </ComparePlot>
        )}
      </Show>
    </div>
  );
}

/** One side's own plot, used when the two grids differ (never interpolated). */
function SidePlot(props: {
  label: string;
  color: string;
  series: SeriesResult | undefined;
  view: SeriesViewConfig;
  scale: uPlot.Scale;
  markers: () => ReturnType<typeof compareMarkers>;
}) {
  return (
    <div class="compare-side">
      <div class="compare-side-label" style={{ color: props.color }}>
        {props.label}
      </div>
      <Show
        when={props.series}
        fallback={<div class="analyzer-empty">This project has no result for the window.</div>}
      >
        {(series) => (
          <Show when={activeThemeId()} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[cursor(), props.markers()]}
              data={[series().times, series().values]}
              series={[{}, { label: props.label, stroke: props.color, width: 1.2 }]}
              scales={{ x: { time: false }, y: props.scale }}
              axes={[timeAxis(), valueAxis(props.view.yLabel)]}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}

function formatDelta(value: number | null | undefined): string {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}
