import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import { createMemo, createSignal, Show } from "solid-js";
import ReframeMenu, { type ReframeTarget } from "./ReframeMenu";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, playheadRule, syncView } from "./syncPlugins";
import { annotationMarkers } from "./annotationPlugins";
import { noteSegments } from "./noteSegmentPlugins";
import { semitoneGrid } from "./seriesPlugins";
import {
  cents,
  duration,
  hz,
  level,
  percent,
  periodicity,
  relative,
  spread,
} from "./noteMetricsFormat";
import { logYRange, paddedYRange } from "./range";
import {
  frequencyAxisValues,
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import { chartAxisStyle, createUplotReframeHandler, UplotChartPlot } from "./chartCommon";
import ChartLegend, { type ChartLegendEntry } from "./chartLegend";
import { gapAt, noteAt, segmentEnvelope } from "../../lib/noteSegments";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import { useUplotImage } from "./chartImage";
import type { AnalyzerId, NoteMetricsResult } from "../../state/analyzer";

/** The shared left-margin width, so the level and pitch lanes line up. */
const NOTE_AXIS_SIZE = 64;

/**
 * The note-segments chart (M18/M19 view): every detected musical note placed on the
 * source timeline.
 *
 * **Two aligned lanes** (M36, chart review item 10). The main lane carries the level
 * encoding — each note's envelope line, its **peak** and **RMS** rules (the cap between
 * them is the crest) and its span as a block — plus segment **boundaries**, the voiced
 * ruler, gap bands and the gate. The per-note median **f0** moved to its own pitch lane
 * below, on a log frequency axis with semitone rules: it is a summary, not a pitch
 * track, and it no longer competes with dBFS on a shared short plot.
 *
 * Blocks show their duration inside the span only when the pixels allow it; otherwise
 * the tooltip and the table carry it. Hovering a note outlines it, reports it to the
 * table, and the hover card shows the whole record. x is source seconds and joins the
 * `"time"` sync group; the bottom lane still belongs to the project's own annotations
 * (`annotationMarkers`). See `docs/analysis-tools.md` → Chart rendering.
 */
export default function NoteSegmentChart(props: {
  id: AnalyzerId;
  result: () => NoteMetricsResult | null;
  /** Told which note is under the pointer so the table can highlight its row. */
  onHover?: (index: number | null) => void;
}) {
  const zoom = createUplotZoom("time");
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);

  // Export the per-note segment chart (M12).
  useUplotImage(() => props.id, zoom.instance);

  const notes = () => props.result()?.notes ?? [];
  const hasF0 = () => notes().some((note) => note.f0MedianHz != null);
  const data = createMemo(() => {
    const result = props.result();
    return result ? segmentEnvelope(result) : { xs: [], levels: [], f0: [] };
  });

  /** The level scale has to hold the peaks too — they sit above the frame-RMS envelope. */
  const levelRange = (_u: unknown, min: number, max: number): [number, number] => {
    let lo = min;
    let hi = max;
    for (const note of notes()) {
      if (Number.isFinite(note.peakDb)) hi = Math.max(hi, note.peakDb);
      if (Number.isFinite(note.rmsDb)) lo = Math.min(lo, note.rmsDb);
    }
    return paddedYRange(_u, lo, hi);
  };

  /** A remount (not a data update) is what can change the series/axes: theme + f0. */
  const chartKey = () => `${activeThemeId() ?? ""}|${hasF0() ? "f0" : "level-only"}`;

  /** Note-aware tooltip: the whole record under the pointer, else the gap it sits in. */
  const Tooltip = (tip: TooltipProps) => {
    const note = () => noteAt(notes(), tip.cursor.xValue);
    const gap = () => {
      const result = props.result();
      return result ? gapAt(result, tip.cursor.xValue) : null;
    };
    return (
      <div class="chart-tooltip note-segment-tooltip">
        <div class="chart-tooltip-x">t {tip.cursor.xValue.toFixed(3)} s</div>
        <Show
          when={note()}
          fallback={
            <Show
              when={gap()}
              fallback={
                <div class="chart-tooltip-row">
                  <span class="chart-tooltip-label">gap</span>
                  <span class="chart-tooltip-value">—</span>
                </div>
              }
            >
              {(found) => (
                <>
                  <div class="chart-tooltip-row">
                    <span class="chart-tooltip-label">Gap</span>
                    <span class="chart-tooltip-value">{duration(found().durationSecs)}</span>
                  </div>
                  <div class="chart-tooltip-row">
                    <span class="chart-tooltip-label">Where</span>
                    <span class="chart-tooltip-value">
                      {found().kind === "between" ? "between notes" : `${found().kind} silence`}
                    </span>
                  </div>
                  <div class="chart-tooltip-row">
                    <span class="chart-tooltip-label">Span</span>
                    <span class="chart-tooltip-value">
                      {found().startSecs.toFixed(3)} – {found().endSecs.toFixed(3)} s
                    </span>
                  </div>
                </>
              )}
            </Show>
          }
        >
          {(found) => (
            <>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">Note</span>
                <span class="chart-tooltip-value">
                  {found().index + 1} / {notes().length}
                  {found().index === props.result()?.referenceNoteIndex ? " · reference" : ""}
                </span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">Span</span>
                <span class="chart-tooltip-value">
                  {found().note.startSecs.toFixed(3)} – {found().note.endSecs.toFixed(3)} s
                </span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">Duration</span>
                <span class="chart-tooltip-value">{duration(found().note.durationSecs)}</span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">Gaps</span>
                <span class="chart-tooltip-value">
                  {duration(found().note.gapBeforeSecs)} before ·{" "}
                  {duration(found().note.gapAfterSecs)} after
                </span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">RMS / peak</span>
                <span class="chart-tooltip-value">
                  {level(found().note.rmsDb)} · {level(found().note.peakDb)}
                </span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">Δ loudest</span>
                <span class="chart-tooltip-value">
                  {relative(found().note.rmsDbRelLoudest)} ·{" "}
                  {relative(found().note.peakDbRelLoudest)}
                </span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">Voiced / f0</span>
                <span class="chart-tooltip-value">
                  {percent(found().note.voicedFraction)} · {hz(found().note.f0MedianHz)}
                </span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">Jitter / shimmer</span>
                <span class="chart-tooltip-value">
                  {cents(found().note.jitterProxyCents)} · {spread(found().note.shimmerProxyDb)}
                </span>
              </div>
              <div class="chart-tooltip-row">
                <span class="chart-tooltip-label">HNR proxy</span>
                <span class="chart-tooltip-value">{periodicity(found().note.hnrProxy)}</span>
              </div>
            </>
          )}
        </Show>
      </div>
    );
  };

  /** The pitch lane's tooltip: the median f0 of the note under the pointer. */
  const PitchTooltip = (tip: TooltipProps) => {
    const note = () => noteAt(notes(), tip.cursor.xValue);
    return (
      <div class="chart-tooltip note-segment-tooltip">
        <div class="chart-tooltip-x">t {tip.cursor.xValue.toFixed(3)} s</div>
        <div class="chart-tooltip-row">
          <span class="chart-tooltip-label">median f0</span>
          <span class="chart-tooltip-value">{hz(note()?.note.f0MedianHz ?? null)}</span>
        </div>
      </div>
    );
  };

  const openMenu = createUplotReframeHandler(zoom, setMenu);
  /** The chart's marks, as the shared legend renders them (the colours are theme roles). */
  const legend = (): ChartLegendEntry[] => [
    { label: "envelope", color: chartTheme().series },
    { label: "RMS", color: chartTheme().axis },
    { label: "peak", color: chartTheme().seriesMax, kind: "dashed" },
    { label: "voiced", color: chartTheme().series, kind: "split" },
    { label: "gap", color: chartTheme().axis, kind: "fill" },
    ...(hasF0() ? [{ label: "median f0 (pitch lane)", color: chartTheme().markerBeat }] : []),
  ];

  return (
    <div class="note-segments-chart" data-testid="noteMetrics.chart">
      <ChartLegend
        entries={legend()}
        note={`gate ${props.result()?.thresholdDb.toFixed(1)} dBFS`}
      />
      <div class="note-segments-plots">
        <UplotChartPlot
          class="note-level-plot"
          zoom={zoom}
          onWheel={zoom.wheel}
          onContextMenu={openMenu}
        >
          <Show when={chartKey()} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[
                cursor(),
                tooltip(Tooltip),
                mirrorCursor("time"),
                syncView("time"),
                playheadRule(),
                annotationMarkers(props.id),
                noteSegments(
                  () => ({
                    windowStart: props.result()?.windowStart ?? 0,
                    notes: notes(),
                    reference: props.result()?.referenceNoteIndex ?? null,
                    threshold: props.result()?.thresholdDb ?? 0,
                  }),
                  props.onHover,
                ),
              ]}
              onCreate={zoom.onReady}
              data={[data().xs, data().levels]}
              series={[
                {},
                {
                  label: "Level",
                  stroke: chartTheme().series,
                  width: 1,
                  spanGaps: false,
                },
              ]}
              scales={{ x: { time: false }, y: { range: levelRange } }}
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
                  label: "level (dBFS)",
                  // Both lanes keep the same left margin, so their time axes align.
                  size: NOTE_AXIS_SIZE,
                  space: Y_AXIS_SPACE,
                },
              ]}
            />
          </Show>
        </UplotChartPlot>
        {/* The median f0 lane: a flat per-note summary on a log pitch axis with
            semitone rules, aligned to the level plot above (M36, item 10). */}
        <Show when={hasF0()}>
          <div class="note-pitch-lane">
            <Show when={chartKey()} keyed>
              <SolidUplot
                autoResize
                pluginBus={analyzerBus}
                plugins={[
                  cursor(),
                  tooltip(PitchTooltip),
                  mirrorCursor("time"),
                  syncView("time"),
                  semitoneGrid(),
                ]}
                data={[data().xs, data().f0]}
                series={[
                  {},
                  {
                    label: "median f0",
                    scale: "f0",
                    stroke: chartTheme().markerBeat,
                    width: 2,
                    dash: [4, 3],
                    spanGaps: false,
                  },
                ]}
                scales={{ x: { time: false }, f0: { distr: 3, log: 10, range: logYRange } }}
                axes={[
                  { ...chartAxisStyle(), show: false, size: 0 },
                  {
                    ...chartAxisStyle(),
                    scale: "f0",
                    label: "f0 (Hz)",
                    size: NOTE_AXIS_SIZE,
                    space: Y_AXIS_SPACE,
                    values: frequencyAxisValues,
                  },
                ]}
              />
            </Show>
          </div>
        </Show>
      </div>
      <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
    </div>
  );
}
