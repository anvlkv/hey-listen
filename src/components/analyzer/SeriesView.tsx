import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { createSignal, For, Show, untrack } from "solid-js";
import Readout from "./Readout";
import ReframeMenu, { type ReframeTarget } from "./ReframeMenu";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, playheadRule, syncView } from "./syncPlugins";
import { referenceLine, semitoneGrid } from "./seriesPlugins";
import { noteMarkers } from "./notePlugins";
import { paddedYRange } from "./range";
import { coverage, seriesReadouts } from "./readouts";
import {
  frequencyAxisValues,
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import {
  chartAxisStyle,
  createUplotReframeHandler,
  NoAudioState,
  timeRangeLabel,
  timeTooltip,
} from "./chartCommon";
import { analyzerBus } from "../../state/chartSync";
import { chartTheme, resolvedTheme } from "../../state/themes";
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

/** A log-scale y-range with a little headroom, clamped so it never reaches 0. */
function logYRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 0.1;
  const hi = max > lo ? max : lo * 10;
  return [lo / 1.15, hi * 1.15];
}

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

/** The voiced share of a pitch result (server-provided; falls back to the values). */
function voicedShare(result: SeriesResult): number {
  return (result as Partial<PitchResult>).voicedFraction ?? coverage(result.values);
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
  const zoom = createUplotZoom("time");
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);

  // The registry's formatter is static for a tool, so build the tooltip once.
  const Tooltip = timeTooltip(untrack(() => view().formatY));
  const seriesStyle = () => view().style ?? "line";
  const seriesPaths = () => {
    const style = seriesStyle();
    if (style === "stepped") return uPlot.paths.stepped?.({ align: 1 });
    if (style === "stems") return stemsPath;
    return undefined;
  };

  const data = (): [number[], (number | null)[]] => {
    const r = result();
    if (!r || r.times.length === 0) return [[], []];
    return [r.times, r.values];
  };

  /** A chart needs at least two frames and some non-gap values. */
  const plottable = () => {
    const r = result();
    return !!r && r.times.length >= 2 && r.values.some((value) => value != null);
  };

  /** Right-click: reframe the timeline window from the time under the pointer. */
  const openMenu = createUplotReframeHandler(zoom, setMenu);

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
            </Show>
          </div>
          <div class="analyzer-plot" onWheel={zoom.wheel} onContextMenu={openMenu}>
            <Show
              when={plottable()}
              fallback={
                <div class="analyzer-empty">
                  {isPitch(props.id)
                    ? "No voiced frames — the signal may be unpitched or polyphonic, or its fundamental may lie outside the detector's range (pYIN/YIN: 50–2000 Hz). Adjust the f0 range or try another detector."
                    : "No values in this window — widen the analysis window or change the FFT size."}
                </div>
              }
            >
              <ZoomControls
                onZoomIn={zoom.zoomIn}
                onZoomOut={zoom.zoomOut}
                onFit={zoom.fit}
                label={timeRangeLabel(zoom.range())}
              />
              <Show when={resolvedTheme()} keyed>
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
                    ...(view().reference ? [referenceLine(view().reference!)] : []),
                    ...(view().semitoneGrid ? [semitoneGrid()] : []),
                  ]}
                  onCreate={zoom.onReady}
                  data={data()}
                  series={[
                    {},
                    {
                      label: view().yLabel,
                      stroke: chartTheme().series,
                      width: 1,
                      fill: seriesStyle() === "area" ? chartTheme().waveFill : undefined,
                      points: { show: view().points ?? false, size: 4 },
                      paths: seriesPaths(),
                    },
                  ]}
                  scales={{
                    x: { time: false },
                    y:
                      view().yScale === "log"
                        ? { distr: 3, log: 10, range: logYRange }
                        : { range: view().yRange ? () => view().yRange! : paddedYRange },
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
                      label: view().yLabel,
                      size: Y_AXIS_SIZE,
                      space: Y_AXIS_SPACE,
                      // Pitch tools plot f0 in Hz, so label that axis in kHz too.
                      values: isPitch(props.id) ? frequencyAxisValues : undefined,
                    },
                  ]}
                />
              </Show>
            </Show>
          </div>
          <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
        </div>
      )}
    </Show>
  );
}
