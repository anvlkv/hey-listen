import { SolidUplot, type UplotPluginFactory } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  Show,
  untrack,
} from "solid-js";
import ChartTooltip from "./ChartTooltip";
import Readout from "./Readout";
import ReframeMenu, { type ReframeTarget } from "./ReframeMenu";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, playheadRule, syncView } from "./syncPlugins";
import { noteMarkers } from "./notePlugins";
import { paddedYRange } from "./range";
import { X_AXIS_SIZE, Y_AXIS_SIZE, Y_AXIS_SPACE } from "./axisFormat";
import {
  chartAxisStyle,
  createUplotReframeHandler,
  NoAudioState,
  timeRangeLabel,
  timeTooltip,
} from "./chartCommon";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { registerChartImage, unregisterChartImage } from "../../state/exportRegistry";
import { activeThemeId, chartTheme } from "../../state/themes";
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

/** Downbeats are drawn heavier than beats / onsets, so the bar is unmistakable. */
const MARKER_WIDTH: Record<MarkerKind, number> = { onsets: 1, beats: 1, downbeats: 2 };

/** The chart-palette field each marker kind draws in (see `ChartTheme`). */
const MARKER_FIELD: Record<MarkerKind, "markerOnset" | "markerBeat" | "markerDownbeat"> = {
  onsets: "markerOnset",
  beats: "markerBeat",
  downbeats: "markerDownbeat",
};

/**
 * Draws vertical event markers (beats / onsets / downbeats) over the onset-strength
 * envelope. Reads them through a reactive accessor so the markers follow the result
 * (the chart is not recreated on data change).
 */
const rhythmMarkers =
  (getMarkers: () => MarkerSet[]): UplotPluginFactory<AnalyzerBus> =>
  () => {
    let current: MarkerSet[] = [];
    let dispose: (() => void) | undefined;
    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            createEffect(() => {
              current = getMarkers();
              u.redraw();
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

/** Tempo candidates for the tempogram (BPM). */
const TEMPO_MIN_BPM = 40;
const TEMPO_MAX_BPM = 240;
const TEMPO_STEPS = 200;

/**
 * Autocorrelation of the onset-strength envelope over the BPM search range — the
 * tempo-salience curve the tempogram panel draws. The envelope is mean-removed so
 * the result reflects its modulation (the pulse), not its overall level. This is a
 * derivation from the already-computed envelope, not a new analysis.
 */
function tempoSalience(
  times: number[],
  envelope: number[],
): { bpm: number[]; salience: number[] } | null {
  const n = envelope.length;
  if (n < 8 || times.length !== n) return null;
  const dt = (times[n - 1] - times[0]) / (n - 1);
  if (!(dt > 0)) return null;
  let mean = 0;
  for (const value of envelope) mean += value;
  mean /= n;
  const centred = envelope.map((value) => value - mean);

  const bpm: number[] = [];
  const salience: number[] = [];
  for (let s = 0; s < TEMPO_STEPS; s++) {
    const rate = TEMPO_MIN_BPM + (s / (TEMPO_STEPS - 1)) * (TEMPO_MAX_BPM - TEMPO_MIN_BPM);
    const lag = Math.max(1, Math.round(60 / rate / dt));
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < n; i++) {
      sum += centred[i] * centred[i + lag];
      count++;
    }
    bpm.push(rate);
    salience.push(count > 0 ? sum / count : 0);
  }
  return { bpm, salience };
}

/** Mark the chosen tempo on the tempogram with a vertical line. */
const tempoMarker =
  (getBpm: () => number): UplotPluginFactory<AnalyzerBus> =>
  () => {
    let bpm = 0;
    let dispose: (() => void) | undefined;
    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            createEffect(() => {
              bpm = getBpm();
              u.redraw();
            });
            return root;
          });
        },
        draw: (u) => {
          if (!(bpm > 0) || !u.ctx) return;
          const x = u.valToPos(bpm, "x", true);
          const { ctx, bbox } = u;
          if (!Number.isFinite(x) || x < bbox.left || x > bbox.left + bbox.width) return;
          ctx.save();
          ctx.strokeStyle = chartTheme().reference;
          ctx.lineWidth = 1.5;
          const px = Math.round(x) + 0.5;
          ctx.beginPath();
          ctx.moveTo(px, bbox.top);
          ctx.lineTo(px, bbox.top + bbox.height);
          ctx.stroke();
          ctx.restore();
        },
        destroy: () => dispose?.(),
      },
    };
  };

/** Tooltip for the tempogram panel (BPM × salience). */
const TempoTooltip = (props: TooltipProps) => (
  <ChartTooltip
    {...props}
    xLabel="bpm"
    formatX={(value) => `${value.toFixed(0)} BPM`}
    formatY={(value) => value.toFixed(3)}
  />
);

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
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);

  // Export the rendered onset-strength chart (M12).
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

  /** Right-click the envelope: reframe the timeline window, or add a note here. */
  const openMenu = createUplotReframeHandler(zoom, setMenu);

  /** Tempo-salience curve over the BPM range (tempo / downbeat tools only). */
  const tempogram = createMemo(() => {
    const r = result();
    if (!r || !(r.bpm > 0)) return null;
    return tempoSalience(r.times, r.onsetStrength);
  });

  const markers = (): MarkerSet[] => {
    const r = result();
    if (!r) return [];
    const theme = chartTheme();
    const sets: MarkerSet[] = [];
    for (const kind of config().markers) {
      const times =
        kind === "onsets" ? r.onsetTimes : kind === "beats" ? r.beatTimes : r.downbeatTimes;
      sets.push({ times, color: theme[MARKER_FIELD[kind]], width: MARKER_WIDTH[kind] });
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
      <div class="analyzer-plot" onWheel={zoom.wheel} onContextMenu={openMenu}>
        <Show when={result()} fallback={<NoAudioState />}>
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
            <Show when={activeThemeId()} keyed>
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
                axes={[
                  { ...chartAxisStyle(), label: "time (s)" },
                  { ...chartAxisStyle(), label: "onset strength" },
                ]}
              />
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={tempogram()}>
        {(t) => (
          <div class="analyzer-tempogram">
            <div class="analyzer-tempogram-label">Tempo salience</div>
            <Show when={activeThemeId()} keyed>
              <SolidUplot
                autoResize
                pluginBus={analyzerBus}
                data={[t().bpm, t().salience]}
                series={[
                  {},
                  {
                    label: "Salience",
                    stroke: chartTheme().series,
                    width: 1,
                    fill: chartTheme().waveFill,
                  },
                ]}
                scales={{
                  x: { time: false, range: [TEMPO_MIN_BPM, TEMPO_MAX_BPM] },
                  y: { range: paddedYRange },
                }}
                axes={[
                  { ...chartAxisStyle(), label: "BPM", size: X_AXIS_SIZE },
                  {
                    ...chartAxisStyle(),
                    label: "salience",
                    size: Y_AXIS_SIZE,
                    space: Y_AXIS_SPACE,
                  },
                ]}
                plugins={[cursor(), tooltip(TempoTooltip), tempoMarker(() => result()?.bpm ?? 0)]}
              />
            </Show>
          </div>
        )}
      </Show>
      <ReframeMenu target={menu()} onClose={() => setMenu(null)} tool={props.id} />
    </div>
  );
}
