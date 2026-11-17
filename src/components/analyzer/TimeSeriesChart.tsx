import { SolidUplot } from "@dschz/solid-uplot";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import { cursor } from "@dschz/solid-uplot/plugins";
import { tooltip } from "./tooltipPlugins";
import uPlot from "uplot";
import { Show, createMemo, createSignal, untrack } from "solid-js";
import { type UplotZoom } from "./uplotZoom";
import { mirrorCursor, playheadRule, syncView } from "./syncPlugins";
import { referenceLine, semitoneGrid } from "./seriesPlugins";
import { annotationMarkers } from "./annotationPlugins";
import { drilldownLane, drilldownImage } from "./drilldownLane";
import DrilldownCard, { type CardCursor } from "./DrilldownCard";
import { nearestFrame, type DrilldownGrid, type RateSnapshot } from "./drilldown";
import type { HeatmapScale } from "./heatmapScale";
import { logYRange, paddedYRange } from "./range";
import {
  frequencyAxisValues,
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import { chartAxisStyle, timeTooltip } from "./chartCommon";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import type { AnalyzerId, SeriesView } from "../../state/analyzer";

/** Impulse ("stem") path builder: a vertical line from the plot floor to each value. */
const stemsPath = (
  u: uPlot,
  seriesIdx: number,
  idx0: number,
  idx1: number,
): uPlot.Series.Paths | null => {
  const path = new Path2D();
  const base = u.bbox.top + u.bbox.height;
  const xs = u.data[0];
  const ys = u.data[seriesIdx];
  if (!xs || !ys) return null;
  for (let i = idx0; i <= idx1; i++) {
    const value = ys[i];
    const x = xs[i];
    if (typeof value !== "number" || typeof x !== "number" || !Number.isFinite(value)) continue;
    const px = u.valToPos(x, "x", true);
    const py = u.valToPos(value, "y", true);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    path.moveTo(px, base);
    path.lineTo(px, py);
  }
  return { stroke: path };
};

/**
 * Show the sample dots when they are far enough apart to be distinct points, so a
 * sparse track (a sampled measurement) never reads as a continuous curve (M36).
 */
function sparsePoints(u: uPlot): boolean {
  const xs = u.data[0];
  const width = u.bbox?.width ?? u.width ?? 0;
  return xs.length > 0 && width / xs.length >= 4;
}

/**
 * A sample's formatted value, or a dash for a gap — the cursor readout's own cell.
 * `undefined` is a real case: uPlot's columns may be shorter than the sample index.
 */
function formatSample(format: (value: number) => string, value: unknown): string {
  return typeof value === "number" ? format(value) : "–";
}

/**
 * A second track on its own right-hand scale: a phon track beside sones, or a
 * per-frame confidence beside f0. The values must be parallel to the chart's x
 * column; an absent track is passed as all-gaps instead of removing the series (the
 * wrapper fixes `series` at mount).
 */
export interface SecondaryTrack {
  label: string;
  values: (number | null)[];
  yLabel: string;
  format: (value: number) => string;
  /** A `chartTheme()` role resolved by the caller, never a literal. */
  stroke: string;
  /** A fixed y-range (e.g. `[0, 1]` for confidence); auto-padded when omitted. */
  yRange?: [number, number];
  points?: boolean;
  dash?: number[];
}

/** A reference line on a named scale (a confidence threshold on `y2`). */
export interface SeriesReferenceLine {
  value: number;
  label: string;
  /** The uPlot scale key; `"y"` when omitted. */
  scale?: string;
}

/** Props for the shared 1-D time chart (series tracks and the loudness curve). */
export interface TimeSeriesChartProps {
  id: AnalyzerId;
  zoom: UplotZoom;
  data: [number[], (number | null)[]];
  yLabel: string;
  formatY: (value: number) => string;
  seriesStyle?: "line" | "area" | "stepped" | "stems";
  /** How one sample relates to time — selects an honest path (M36). */
  sampling?: SeriesView["sampling"];
  /** Area-fill the primary track (a level envelope, from a meaningful baseline). */
  fill?: boolean;
  points?: boolean;
  yScale?: "linear" | "log";
  yRange?: [number, number];
  reference?: { value: number; label: string };
  /** Extra reference lines, each on a named scale (this is how a `y2` threshold is drawn). */
  referenceLines?: SeriesReferenceLine[];
  semitoneGrid?: boolean;
  /** Label the y-axis in Hz too (pitch tracks). */
  frequencyY?: boolean;
  /** Right-hand tick width when the note-plus-Hz labels need more room. */
  yAxisSize?: number;
  /** The second track on a right-hand scale (a phon or confidence axis). */
  secondary?: SecondaryTrack;
  /** Extra `draw` plugins appended to the synced stack (the octave-ambiguity rings). */
  plugins?: UplotPluginFactory<AnalyzerBus>[];
  /** A result drill-down: painted inside the plot, detailed under the cursor (M38). */
  drilldown?: SeriesDrilldown;
}

/**
 * A drill-down a series tool carries: the time × row grid behind its scalar track.
 *
 * The grid shares the chart's **time axis**, so it is drawn as a lane inside the same
 * plot rather than as a second chart with its own axis, colourbar and legend. The frame
 * under the cursor is read out in a card (`DrilldownCard.tsx`).
 */
export interface SeriesDrilldown {
  grid: DrilldownGrid;
  /** The one colour scale the lane, the hover card and the legend stripe share. */
  scale: HeatmapScale;
  /** The band × rate grid at a frame (roughness / fluctuation strength only). */
  rate?: (frame: number) => RateSnapshot | null;
  /** The model's weighted rate, named in the card's rate caption. */
  rateTarget?: number;
}

/**
 * The chart body shared by the time-series views (M5, M27, M36): the synced uPlot stack.
 * The caller owns the surrounding readouts, the empty state, the zoom surface and its
 * chrome ([`ChartPlot`](./chartCommon.tsx)).
 *
 * A secondary track is declared statically per tool (never inferred from data), so the
 * wrapper's fixed `series`/`scales` arrays are built once and an absent track is simply
 * an all-gap column. Nulls stay gaps (no spline, no `spanGaps`).
 */
export default function TimeSeriesChart(props: TimeSeriesChartProps) {
  // The secondary track is declared once per tool, so the tooltip's per-scale formats
  // are captured at mount alongside the (static) series/scales arrays.
  const secondaryTooltip = untrack(() => props.secondary);
  const Tooltip = timeTooltip(
    untrack(() => props.formatY),
    secondaryTooltip ? { formatScale: { y2: secondaryTooltip.format }, hideScales: [] } : undefined,
  );
  const style = () => props.seriesStyle ?? "line";
  const filled = () => props.fill ?? style() === "area";
  const paths = () => {
    // Stems win over everything: an event-like score is one mark per frame.
    if (style() === "stems") return stemsPath;
    // A block / step measure holds between samples; a frame-centre measurement is a
    // sample at an instant, joined linearly (a visual aid, never an implied measure).
    if (props.sampling === "block" || props.sampling === "step" || style() === "stepped") {
      return uPlot.paths.stepped?.({ align: 1 });
    }
    return uPlot.paths.linear?.();
  };
  /** Sample dots: when asked for, or when a frame-centre track is sparse. */
  const showPoints = () => props.points ?? props.sampling === "frame-centre";

  /** The columns: x, the primary track, then the secondary track when declared. */
  const data = (): uPlot.AlignedData => {
    const [xs, values] = props.data;
    const secondary = props.secondary;
    return secondary ? [xs, values, secondary.values] : [xs, values];
  };

  const referencePlugins = () => [
    ...(props.reference ? [referenceLine(props.reference)] : []),
    ...(props.referenceLines ?? []).map((line) => referenceLine(line, line.scale)),
  ];

  /** The drill-down's colour scale and image — the caller resolves the scale once (M38). */
  const laneScale = () => props.drilldown?.scale ?? null;
  const laneImage = createMemo(() => {
    // The ramp comes from the active theme, so a theme switch must rebuild the lane.
    activeThemeId();
    const spec = props.drilldown;
    return spec ? drilldownImage(spec.grid, spec.scale) : null;
  });

  /** Where the pointer sits, or `null` when it is off the plot. */
  const [hover, setHover] = createSignal<CardCursor | null>(null);
  const [instance, setInstance] = createSignal<Parameters<UplotZoom["onReady"]>[0] | null>(null);

  /** The hovered frame's band × rate grid, when the tool carries one. */
  const hoverRate = createMemo(() => {
    const point = hover();
    const spec = props.drilldown;
    if (!point || !spec?.rate) return null;
    return spec.rate(nearestFrame(spec.grid, point.time));
  });

  /**
   * The cursor readout the card carries in place of the tooltip (one hover surface):
   * each drawn track's value at the cursor's sample, formatted by its own tool.
   */
  const hoverValues = (): { label: string; value: string }[] => {
    const point = hover();
    const u = instance();
    if (!point || !u) return [];
    const rows = [
      { label: props.yLabel, value: formatSample(props.formatY, u.data[1]?.[point.idx]) },
    ];
    const secondary = props.secondary;
    if (secondary) {
      rows.push({
        label: secondary.label,
        value: formatSample(secondary.format, u.data[2]?.[point.idx]),
      });
    }
    return rows;
  };

  /** The lane is drawn inside this plot; its `pointerleave` hides the card. */
  const drilldownPlugins = () =>
    props.drilldown
      ? [
          drilldownLane({
            grid: () => props.drilldown?.grid ?? null,
            image: laneImage,
            onLeave: () => setHover(null),
          }),
        ]
      : [];

  return (
    <>
      <Show when={activeThemeId()} keyed>
        <SolidUplot
          autoResize
          pluginBus={analyzerBus}
          plugins={[
            cursor(),
            // A drill-down chart's readout is the card, so the tooltip would be a second
            // floating box beside it (one hover surface — M38).
            ...(props.drilldown ? [] : [tooltip(Tooltip)]),
            mirrorCursor("time"),
            syncView("time"),
            playheadRule(),
            annotationMarkers(props.id),
            ...referencePlugins(),
            ...(props.semitoneGrid ? [semitoneGrid()] : []),
            ...drilldownPlugins(),
            ...(props.plugins ?? []),
          ]}
          onCreate={(u) => {
            setInstance(() => u);
            setHover(null);
            props.zoom.onReady(u);
          }}
          onCursorMove={({ cursor }) =>
            setHover({
              left: cursor.position.left,
              top: cursor.position.top,
              idx: cursor.idx,
              time: cursor.xValue,
            })
          }
          data={data()}
          series={[
            {},
            {
              label: props.yLabel,
              stroke: chartTheme().series,
              width: 1,
              fill: filled() ? chartTheme().waveFill : undefined,
              // A gated / unvoiced frame is a gap: never join across one.
              spanGaps: false,
              points: {
                show: showPoints() ? (u: uPlot) => (props.points ? true : sparsePoints(u)) : false,
                size: 4,
              },
              paths: paths(),
            },
            ...(props.secondary
              ? [
                  {
                    label: props.secondary.label,
                    scale: "y2",
                    stroke: props.secondary.stroke,
                    width: 1,
                    dash: props.secondary.dash,
                    spanGaps: false,
                    points: { show: props.secondary.points ?? false, size: 4 },
                  },
                ]
              : []),
          ]}
          scales={{
            x: { time: false },
            y:
              props.yScale === "log"
                ? { distr: 3, log: 10, range: logYRange }
                : { range: props.yRange ? () => props.yRange! : paddedYRange },
            ...(props.secondary
              ? {
                  y2: props.secondary.yRange
                    ? { range: () => props.secondary!.yRange! }
                    : { range: paddedYRange },
                }
              : {}),
          }}
          axes={[
            {
              ...chartAxisStyle(),
              label: "time (s)",
              size: X_AXIS_SIZE,
              space: TIME_AXIS_SPACE,
              values: timeAxisValues,
            },
            {
              ...chartAxisStyle(),
              label: props.yLabel,
              size: props.yAxisSize ?? Y_AXIS_SIZE,
              space: Y_AXIS_SPACE,
              values: props.frequencyY ? frequencyAxisValues : undefined,
            },
            ...(props.secondary
              ? [
                  {
                    ...chartAxisStyle(),
                    scale: "y2",
                    side: 1 as const,
                    label: props.secondary.yLabel,
                    size: Y_AXIS_SIZE,
                    space: Y_AXIS_SPACE,
                    grid: { show: false },
                  },
                ]
              : []),
          ]}
        />
      </Show>
      <Show when={props.drilldown && hover() && instance() && laneScale()}>
        <DrilldownCard
          u={instance()!}
          cursor={hover()!}
          grid={props.drilldown!.grid}
          scale={laneScale()!}
          values={hoverValues()}
          rate={hoverRate()}
          rateTarget={props.drilldown!.rateTarget}
        />
      </Show>
    </>
  );
}
