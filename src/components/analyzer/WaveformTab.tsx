import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import { createSignal, Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ToolParamsForm from "./ToolParamsForm";
import Readout from "./Readout";
import ReframeMenu, { type ReframeTarget } from "./ReframeMenu";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { referenceLine } from "./seriesPlugins";
import { noteMarkers } from "./notePlugins";
import {
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
import { createAnalysis, toolOptions, type WaveformResult } from "../../state/analyzer";

/** A ~72 dB window anchored on the frame peak, never above 0 dBFS. */
function dbYRange(_u: unknown, min: number, max: number): [number, number] {
  const hi = Math.min(Math.max(max, min + 6), 6);
  return [Math.max(hi - 72, -120), hi + 3];
}

/** uPlot y-axis formatter for the dB scale (uPlot may pass null minor splits). */
function dbAxisValues(_self: unknown, ticks: (number | null)[]): string[] {
  return ticks.map((t) => (t == null ? "" : `${t.toFixed(0)} dB`));
}

/**
 * Waveform tool: the min/max envelope of the **conditioned** signal over the
 * analysis window, with peak / RMS levels from oxiaudio. The per-tool **dB scale**
 * toggle collapses the envelope to a single |peak| curve in dBFS (0 dBFS at the
 * top) with a 0 dBFS reference line. See `docs/analysis-tools.md`.
 */
export default function WaveformTab() {
  const analysis = createAnalysis<WaveformResult>("waveform");
  const zoom = createUplotZoom("time");
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);

  const dbMode = () => (toolOptions.waveform?.dbScale ?? 0) !== 0;

  const data = (): number[][] => {
    const result = analysis.result();
    if (!result || result.max.length === 0) return [[]];
    const count = result.max.length;
    const step = count > 0 ? result.duration / count : 0;
    const times = new Array<number>(count);
    // The envelope buckets are evenly spaced across the window, which starts at
    // `windowStart` — the axis is in source seconds like every other chart.
    for (let i = 0; i < count; i++) times[i] = result.windowStart + i * step;
    if (dbMode()) {
      // Collapse the signed min/max envelope to a |peak| curve in dBFS.
      const peakDb = new Array<number>(count);
      for (let i = 0; i < count; i++) {
        const peak = Math.max(Math.abs(result.max[i]), Math.abs(result.min[i]), 1e-6);
        peakDb[i] = 20 * Math.log10(peak);
      }
      return [times, peakDb];
    }
    return [times, result.max, result.min];
  };

  const Tooltip = timeTooltip((value) => (dbMode() ? `${value.toFixed(1)} dB` : value.toFixed(3)));

  /** Right-click: reframe the timeline window from the time under the pointer. */
  const openMenu = createUplotReframeHandler(zoom, setMenu);

  return (
    <AnalyzerTab
      id="waveform"
      loading={analysis.loading()}
      error={analysis.error()}
      hasResult={analysis.result() != null}
      params={<ToolParamsForm id="waveform" />}
    >
      <Show when={analysis.result()} fallback={<NoAudioState />}>
        {(result) => (
          <div class="analyzer-chart">
            <div class="analyzer-readouts">
              <Readout label="Peak" value={`${result().peakDb.toFixed(1)} dBFS`} />
              <Readout label="RMS" value={`${result().rmsDb.toFixed(1)} dBFS`} />
              <Readout label="Duration" value={`${result().duration.toFixed(3)} s`} />
              <Readout label="Rate" value={`${result().sampleRate} Hz`} />
            </div>
            <div class="analyzer-plot" onWheel={zoom.wheel} onContextMenu={openMenu}>
              <Show
                when={data()[0].length >= 2}
                fallback={
                  <div class="analyzer-empty">Empty window — widen the analysis window.</div>
                }
              >
                <ZoomControls
                  onZoomIn={zoom.zoomIn}
                  onZoomOut={zoom.zoomOut}
                  onFit={zoom.fit}
                  label={timeRangeLabel(zoom.range())}
                />
                {/* Remount on theme or scale-mode change: the wrapper fixes `series`
                    at mount, and the two modes declare a different series count. */}
                <Show when={`${resolvedTheme()}|${dbMode() ? "db" : "lin"}`} keyed>
                  <SolidUplot
                    autoResize
                    pluginBus={analyzerBus}
                    plugins={[
                      cursor(),
                      tooltip(Tooltip),
                      mirrorCursor("time"),
                      syncView("time"),
                      noteMarkers("waveform"),
                      ...(dbMode() ? [referenceLine({ value: 0, label: "0 dBFS" })] : []),
                    ]}
                    onCreate={zoom.onReady}
                    data={data()}
                    series={
                      dbMode()
                        ? [
                            {},
                            {
                              label: "Peak (dBFS)",
                              stroke: chartTheme().series,
                              width: 1,
                              fill: chartTheme().waveFill,
                            },
                          ]
                        : [
                            {},
                            { label: "Max", stroke: chartTheme().series, width: 1 },
                            { label: "Min", stroke: chartTheme().series, width: 1 },
                          ]
                    }
                    bands={dbMode() ? undefined : [{ series: [1, 2], fill: chartTheme().waveFill }]}
                    scales={
                      dbMode()
                        ? { x: { time: false }, y: { range: dbYRange } }
                        : { x: { time: false } }
                    }
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
                        label: dbMode() ? "level (dBFS)" : "amplitude",
                        size: Y_AXIS_SIZE,
                        space: Y_AXIS_SPACE,
                        values: dbMode() ? dbAxisValues : undefined,
                      },
                    ]}
                  />
                </Show>
              </Show>
            </div>
            <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool="waveform" />
          </div>
        )}
      </Show>
    </AnalyzerTab>
  );
}
