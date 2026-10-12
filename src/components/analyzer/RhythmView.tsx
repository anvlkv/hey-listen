import { SolidUplot, type UplotPluginFactory } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import { createEffect, createRoot, Show } from "solid-js";
import Readout from "./Readout";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { paddedYRange } from "./range";
import { chartAxisStyle, NoAudioState, timeRangeLabel, timeTooltip } from "./chartCommon";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { chartTheme, resolvedTheme } from "../../state/settings";
import {
  analyzerById,
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type RhythmResult,
  type RhythmView as RhythmViewConfig,
} from "../../state/analyzer";

type MarkerKind = "beats" | "onsets" | "downbeats";

interface MarkerSet {
  times: number[];
  color: string;
  width: number;
}

const MARKER_STYLE: Record<MarkerKind, { dark: string; light: string; width: number }> = {
  onsets: { dark: "rgba(120, 220, 150, 0.6)", light: "rgba(40, 140, 90, 0.55)", width: 1 },
  beats: { dark: "rgba(120, 170, 255, 0.55)", light: "rgba(47, 111, 208, 0.55)", width: 1 },
  downbeats: { dark: "rgba(255, 175, 80, 0.95)", light: "rgba(200, 120, 20, 0.9)", width: 2 },
};

/**
 * Draws vertical event markers (beats / onsets / downbeats) over the onset-strength
 * envelope. Reads them through a reactive accessor so the markers follow the result
 * (the chart is not recreated on data change).
 */
const rhythmMarkers = (getMarkers: () => MarkerSet[]): UplotPluginFactory<AnalyzerBus> => () => {
  let current: MarkerSet[] = [];
  let dispose: (() => void) | undefined;
  return {
    hooks: {
      ready: (u) => {
        dispose = createRoot((root) => {
          createEffect(() => {
            current = getMarkers();
            u.redraw(false);
          });
          return root;
        });
      },
      draw: (u) => {
        if (!u.ctx) return;
        const { ctx, bbox } = u;
        for (const marker of current) {
          ctx.save();
          ctx.strokeStyle = marker.color;
          ctx.lineWidth = marker.width;
          ctx.beginPath();
          for (const time of marker.times) {
            const x = u.valToPos(time, "x", true);
            if (!Number.isFinite(x) || x < bbox.left || x > bbox.left + bbox.width) continue;
            const px = Math.round(x) + 0.5;
            ctx.moveTo(px, bbox.top);
            ctx.lineTo(px, bbox.top + bbox.height);
          }
          ctx.stroke();
          ctx.restore();
        }
      },
      destroy: () => dispose?.(),
    },
  };
};

/**
 * Rhythm view (M5): the onset-strength envelope of the window, with the detected
 * beats / onsets / downbeats drawn as markers on top (which sets depends on the
 * tool). Cursor and time-zoom sync with the other analyzer tabs. See
 * `docs/analysis-tools.md`.
 */
export default function RhythmView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const config = () => analyzerById(props.id).view as RhythmViewConfig;
  const result = () => props.analysis.result() as RhythmResult | null;
  const zoom = createUplotZoom("time");

  const markers = (): MarkerSet[] => {
    const r = result();
    if (!r) return [];
    const sets: MarkerSet[] = [];
    for (const kind of config().markers) {
      const style = MARKER_STYLE[kind];
      const color = resolvedTheme() === "light" ? style.light : style.dark;
      const times =
        kind === "onsets" ? r.onsetTimes : kind === "beats" ? r.beatTimes : r.downbeatTimes;
      sets.push({ times, color, width: style.width });
    }
    return sets;
  };

  const data = (): [number[], number[]] => {
    const r = result();
    if (!r || r.times.length === 0) return [[], []];
    return [r.times, r.onsetStrength];
  };

  const Tooltip = timeTooltip((value) => value.toFixed(4));

  return (
    <div class="analyzer-chart">
      <div class="analyzer-readouts">
        <Show when={result()} fallback={<Readout label="Tempo" value="—" />}>
          {(r) => (
            <>
              <Readout
                label="Tempo"
                value={r().bpm > 0 ? `${r().bpm.toFixed(1)} BPM` : "—"}
                title="Estimated tempo"
              />
              <Readout
                label="Confidence"
                value={`${(r().confidence * 100).toFixed(0)}%`}
                title="Tempo estimate confidence"
              />
              <Readout label="Onsets" value={`${r().onsetTimes.length}`} />
              <Readout label="Beats" value={`${r().beatTimes.length}`} />
              <Readout label="Downbeats" value={`${r().downbeatTimes.length}`} />
            </>
          )}
        </Show>
      </div>
      <div class="analyzer-plot" onWheel={zoom.wheel}>
        <Show
          when={result()}
          fallback={<NoAudioState />}
        >
          <Show
            when={data()[0].length >= 2}
            fallback={
              <div class="analyzer-empty">
                No onset activity in this window — try a longer window or a smaller FFT size.
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
                  rhythmMarkers(markers),
                ]}
                onCreate={zoom.onReady}
                data={data()}
                series={[
                  {},
                  {
                    label: "Onset strength",
                    stroke: chartTheme().series,
                    width: 1,
                    fill: chartTheme().waveFill,
                  },
                ]}
                scales={{ x: { time: false }, y: { range: paddedYRange } }}
                axes={[{ ...chartAxisStyle(), label: "time (s)" }, { ...chartAxisStyle(), label: "onset strength" }]}
              />
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
