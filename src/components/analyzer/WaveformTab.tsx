import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import { createSignal, Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import Readout from "./Readout";
import ReframeMenu, { type ReframeTarget } from "./ReframeMenu";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { TIME_AXIS_SPACE, timeAxisValues, X_AXIS_SIZE, Y_AXIS_SIZE, Y_AXIS_SPACE } from "./axisFormat";
import {
  chartAxisStyle,
  createUplotReframeHandler,
  NoAudioState,
  timeRangeLabel,
  timeTooltip,
} from "./chartCommon";
import { analyzerBus } from "../../state/chartSync";
import { chartTheme, resolvedTheme } from "../../state/settings";
import { createAnalysis, type WaveformResult } from "../../state/analyzer";

const Tooltip = timeTooltip((value) => value.toFixed(3));

/**
 * Waveform tool: the min/max envelope of the **conditioned** signal over the
 * analysis window, with peak / RMS levels from oxiaudio. See
 * `docs/analysis-tools.md`.
 */
export default function WaveformTab() {
  const analysis = createAnalysis<WaveformResult>("waveform");
  const zoom = createUplotZoom();
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);

  const data = () => {
    const result = analysis.result();
    if (!result || result.max.length === 0) return [[]] as number[][];
    const count = result.max.length;
    const step = count > 0 ? result.duration / count : 0;
    const times = new Array<number>(count);
    for (let i = 0; i < count; i++) times[i] = i * step;
    return [times, result.max, result.min];
  };

  /** Right-click: reframe the timeline window from the time under the pointer. */
  const openMenu = createUplotReframeHandler(zoom, setMenu);

  return (
    <AnalyzerTab
      id="waveform"
      loading={analysis.loading()}
      error={analysis.error()}
      hasResult={analysis.result() != null}
    >
      <Show
        when={analysis.result()}
        fallback={<NoAudioState />}
      >
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
                  <div class="analyzer-empty">
                    Empty window — widen the analysis window.
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
                    plugins={[cursor(), tooltip(Tooltip), mirrorCursor("time"), syncView("time")]}
                    onCreate={zoom.onReady}
                    data={data()}
                    series={[
                      {},
                      { label: "Max", stroke: chartTheme().series, width: 1 },
                      { label: "Min", stroke: chartTheme().series, width: 1 },
                    ]}
                    bands={[{ series: [1, 2], fill: chartTheme().waveFill }]}
                    scales={{ x: { time: false } }}
                    axes={[
                      {
                        ...chartAxisStyle(),
                        label: "time (s)",
                        size: X_AXIS_SIZE,
                        space: TIME_AXIS_SPACE,
                        values: timeAxisValues,
                      },
                      { ...chartAxisStyle(), label: "amplitude", size: Y_AXIS_SIZE, space: Y_AXIS_SPACE },
                    ]}
                  />
                </Show>
              </Show>
            </div>
            <ReframeMenu target={menu()} onClose={() => setMenu(null)} />
          </div>
        )}
      </Show>
    </AnalyzerTab>
  );
}
