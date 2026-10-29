import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import { createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import ReframeMenu, { type ReframeTarget } from "./ReframeMenu";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, playheadRule, syncView } from "./syncPlugins";
import { noteMarkers } from "./notePlugins";
import { noteSegments } from "./noteSegmentPlugins";
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
import { paddedYRange } from "./range";
import {
  frequencyAxisValues,
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import { chartAxisStyle, createUplotReframeHandler, timeRangeLabel } from "./chartCommon";
import { gapAt, noteAt, segmentEnvelope } from "../../lib/noteSegments";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import { registerChartImage, unregisterChartImage } from "../../state/exportRegistry";
import type { AnalyzerId, NoteMetricsResult } from "../../state/analyzer";

/**
 * The note-segments chart (M18/M19 view): every detected note placed on the source
 * timeline, with the data the table carries encoded on the chart itself.
 *
 * Level is the shared y-axis: each note's envelope is a line, its **peak** and **RMS**
 * are rules (the cap between them is the crest), and its span is a block. The top
 * ruler is the note's extent split by its **voiced** share; gaps are banded and labelled
 * with their duration; the **gate** is drawn when it is in view. The per-note median
 * **f0** gets its own right-hand axis (a flat segment per note — a summary, not a pitch
 * track). Hovering a note outlines it, reports it to the table, and the hover card shows
 * the whole record: span, gaps, RMS/peak, levels relative to the loudest note, voiced,
 * f0, jitter, shimmer, and the HNR proxy.
 *
 * x is source seconds and joins the `"time"` sync group; the bottom lane still belongs
 * to the project's own annotations (`noteMarkers`). See `docs/analysis-tools.md` →
 * Chart rendering.
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
  const imageProvider = () => zoom.instance()?.ctx.canvas ?? null;
  registerChartImage(
    untrack(() => props.id),
    imageProvider,
  );
  onCleanup(() =>
    unregisterChartImage(
      untrack(() => props.id),
      imageProvider,
    ),
  );

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

  const openMenu = createUplotReframeHandler(zoom, setMenu);
  const legendMark = (color: string, kind: "line" | "dashed" | "fill" | "split") => (
    <span class={`note-segments-legend-mark is-${kind}`} style={{ "--legend-color": color }}>
      <Show when={kind === "split"}>
        <i />
        <i />
      </Show>
    </span>
  );

  return (
    <div class="note-segments-chart" data-testid="noteMetrics.chart">
      <div class="note-segments-legend">
        <span class="note-segments-legend-item">
          {legendMark(chartTheme().series, "line")} envelope
        </span>
        <span class="note-segments-legend-item">{legendMark(chartTheme().axis, "line")} RMS</span>
        <span class="note-segments-legend-item">
          {legendMark(chartTheme().seriesMax, "dashed")} peak
        </span>
        <Show when={hasF0()}>
          <span class="note-segments-legend-item">
            {legendMark(chartTheme().markerBeat, "dashed")} f0
          </span>
        </Show>
        <span class="note-segments-legend-item">
          {legendMark(chartTheme().series, "split")} voiced
        </span>
        <span class="note-segments-legend-item">{legendMark(chartTheme().axis, "fill")} gap</span>
        <span class="note-segments-legend-gate">
          gate {props.result()?.thresholdDb.toFixed(1)} dBFS
        </span>
      </div>
      <div class="analyzer-plot" onWheel={zoom.wheel} onContextMenu={openMenu}>
        <ZoomControls
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onFit={zoom.fit}
          label={timeRangeLabel(zoom.range())}
        />
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
              noteMarkers(props.id),
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
            data={[data().xs, data().levels, data().f0]}
            series={[
              {},
              {
                label: "Level",
                stroke: chartTheme().series,
                width: 1,
              },
              ...(hasF0()
                ? [
                    {
                      label: "f0",
                      scale: "f0",
                      stroke: chartTheme().markerBeat,
                      width: 2,
                      dash: [6, 4],
                      spanGaps: false,
                      // A flat per-note summary: the vertex dots uPlot would add are
                      // just noise (the values are not per-frame samples).
                      points: { show: false },
                    },
                  ]
                : []),
            ]}
            scales={{
              x: { time: false },
              y: { range: levelRange },
              ...(hasF0() ? { f0: { range: paddedYRange } } : {}),
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
                label: "level (dBFS)",
                size: Y_AXIS_SIZE,
                space: Y_AXIS_SPACE,
              },
              ...(hasF0()
                ? [
                    {
                      ...chartAxisStyle(),
                      scale: "f0",
                      side: 1 as const,
                      label: "f0 (Hz)",
                      size: Y_AXIS_SIZE,
                      space: Y_AXIS_SPACE,
                      values: frequencyAxisValues,
                      grid: { show: false },
                    },
                  ]
                : []),
            ]}
          />
        </Show>
      </div>
      <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
    </div>
  );
}
