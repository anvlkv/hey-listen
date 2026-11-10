import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import type uPlot from "uplot";
import { createEffect, createMemo, Show, untrack } from "solid-js";
import Readout from "./Readout";
import ChartLegend, { type ChartLegendEntry } from "./chartLegend";
import type { UplotZoom } from "./uplotZoom";
import { mirrorCursor, playheadRule, syncView } from "./syncPlugins";
import { annotationMarkers } from "./annotationPlugins";
import { clippingMarks } from "./seriesPlugins";
import {
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "./axisFormat";
import {
  chartAxisStyle,
  createZoomReveal,
  NoAudioState,
  timeTooltip,
  UplotChartPlot,
  ZoomChrome,
  type ChartZoom,
} from "./chartCommon";
import { createSpectrogramCanvas } from "./spectrogramCanvas";
import { SPECTROGRAM_DB_RANGE } from "./spectrogramView";
import { hasFrameData } from "./chartGeometry";
import { frequencyScaleLabel, frequencyScaleOf } from "./frequencyScale";
import { analyzerBus } from "../../state/chartSync";
import { activeThemeId, chartTheme } from "../../state/themes";
import {
  createAnalysis,
  formatHz,
  toolOptions,
  type AnalyzerId,
  type SpectrogramResult,
  type WaveformResult,
} from "../../state/analyzer";

/**
 * The chart's stable id: the annotation tool of the spectrogram lane and the
 * `sourceId` it publishes for time sync. It is the **waveform** tool's id because this
 * pair is composed inside that tab; a `spectrogram` tab open beside it still shares the
 * `"time"` group, so zoom, the mirrored cursor, the playhead and annotations line up.
 */
const PAIR_ID: AnalyzerId = "waveform";

/**
 * The linked **primary diagnostic** (M36): the window's waveform stacked over its
 * spectrogram, sharing one time axis.
 *
 * It is a *composition*, not a bigger tab: the waveform half is the usual synchronized
 * uPlot stack (min/max band, now with the per-bucket RMS series and full-scale clipping
 * marks), and the spectrogram half is the same canvas unit the `spectrogram` tab uses
 * (`createSpectrogramCanvas` — pan, wheel zoom, picking, contours, the annotation lane).
 * No second synchronization path: `syncView("time")`, `mirrorCursor("time")`,
 * `playheadRule()` and the canvas' shared cursor/playhead/annotation draws do all of it.
 *
 * **Pitch overlay.** A pitch track and its harmonic multiples belong on the
 * spectrogram half. `createSpectrogramCanvas` accepts a composed `PitchOverlay`
 * (`spectrogramOverlays(result, pitch)`), and the legend already names `f0` /
 * `harmonics`; the `spectrogram` tab supplies one through `PitchOverlaySource`, and
 * this pair can pass the same overlay when it opts in. F0 is never inferred from the
 * centroid or rolloff the heatmap carries.
 */
export default function SignalDiagnostic(props: {
  /**
   * The tab's time-zoom controller, shared with the tab's plain chart (they are never
   * mounted together). Owning it in the tab keeps one chart-image registration for the
   * `waveform` tool, so PNG export follows whichever half is showing.
   */
  zoom: UplotZoom;
}) {
  const waveform = createAnalysis<WaveformResult>("waveform");
  const spectrogram = createAnalysis<SpectrogramResult>("spectrogram");
  const zoom = untrack(() => props.zoom);

  /** The envelope columns, in source seconds (the window starts at `windowStart`). */
  const buckets = createMemo(
    (): {
      xs: number[];
      max: number[];
      min: number[];
      rms: (number | null)[];
    } | null => {
      const result = waveform.result();
      if (!result || result.max.length === 0) return null;
      const count = result.max.length;
      const step = result.duration / count;
      const xs = new Array<number>(count);
      for (let i = 0; i < count; i++) xs[i] = result.windowStart + i * step;
      // `bucketRms` is aligned with the envelope; a result saved before it existed
      // degrades to gaps rather than inventing a level.
      const rms: (number | null)[] =
        result.bucketRms?.length === count ? result.bucketRms : xs.map(() => null);
      return { xs, max: result.max, min: result.min, rms };
    },
  );

  const data = (): uPlot.AlignedData => {
    const found = buckets();
    if (!found) return [[]];
    return [found.xs, found.max, found.min, found.rms];
  };

  const Tooltip = timeTooltip((value) => value.toFixed(3));

  /** The vertical frequency scale of the spectrogram half (the `spectrogram` tool's). */
  const frequencyScale = () => frequencyScaleOf(toolOptions.spectrogram?.frequencyScale);
  /** The spectral contours to draw (the `spectrogram` tool's view options). */
  const toggles = () => ({
    centroid: (toolOptions.spectrogram?.showCentroid ?? 1) !== 0,
    rolloff: (toolOptions.spectrogram?.showRolloff ?? 1) !== 0,
  });

  const canvas = createSpectrogramCanvas({
    id: PAIR_ID,
    result: () => spectrogram.result(),
    dbRange: () => SPECTROGRAM_DB_RANGE,
    scale: frequencyScale,
    toggles,
  });
  const heatmap = canvas.chart;
  /** The spectrogram half's zoom chrome, revealed only while that half is in use (M36). */
  const spectrogramReveal = createZoomReveal(() => !heatmap.atFit());
  const heatmapChrome = (): ChartZoom => ({
    zoomIn: heatmap.zoomIn,
    zoomOut: heatmap.zoomOut,
    fit: heatmap.fit,
    label: heatmap.zoomLabel(),
  });

  createEffect(() => {
    activeThemeId();
    canvas.overlays();
    frequencyScale();
    heatmap.size();
    heatmap.hover();
    heatmap.view();
    canvas.draw();
  });

  /** One legend row: the waveform marks and whatever the spectrogram half is drawing. */
  const legend = (): ChartLegendEntry[] => {
    const theme = chartTheme();
    const rows: ChartLegendEntry[] = [
      { label: "positive peak", color: theme.seriesMax },
      { label: "negative peak", color: theme.seriesMin },
      { label: "RMS", color: theme.seriesMean },
    ];
    const tracks = canvas.overlays();
    const drawn = toggles();
    if (tracks && drawn.centroid) rows.push({ label: "centroid", color: theme.overlayCentroid });
    if (tracks && drawn.rolloff) rows.push({ label: "rolloff", color: theme.overlayRolloff });
    // Added with the composed pitch track (Phase 2): `f0` then `harmonics`.
    if (tracks?.pitch) rows.push({ label: "f0", color: theme.markerBeat, kind: "dashed" });
    if (tracks?.harmonics?.length) {
      rows.push({ label: "harmonics", color: theme.markerBeat, kind: "dashed" });
    }
    return rows;
  };

  return (
    <div class="analyzer-chart signal-diagnostic" data-testid="waveform.signalDiagnostic">
      <div class="analyzer-readouts">
        <Readout
          label="Peak"
          value={waveform.result() ? `${waveform.result()!.peakDb.toFixed(1)} dBFS` : "—"}
        />
        <Readout
          label="RMS"
          value={waveform.result() ? `${waveform.result()!.rmsDb.toFixed(1)} dBFS` : "—"}
        />
        <Readout
          label="Clipped"
          value={waveform.result() ? `${waveform.result()!.clippedBuckets} buckets` : "—"}
          title="Buckets whose peak reaches full scale (max ≥ 1 or min ≤ −1)."
        />
        <Readout
          label="Duration"
          value={waveform.result() ? `${waveform.result()!.duration.toFixed(3)} s` : "—"}
        />
        <Readout
          label="Freq"
          value={heatmap.hover() ? formatHz(heatmap.hover()!.freq) : "—"}
          title="The frequency under the cursor on the spectrogram half."
        />
      </div>
      <div class="signal-diagnostic-pair">
        <UplotChartPlot class="signal-diagnostic-waveform" zoom={zoom} onWheel={zoom.wheel}>
          <Show
            when={data()[0].length >= 2}
            fallback={<div class="analyzer-empty">Empty window — widen the analysis window.</div>}
          >
            {/* Remount on a theme switch: the wrapper fixes `series` at mount, so a
                theme must rebuild the chart to recolour it. */}
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
                  annotationMarkers(PAIR_ID),
                  clippingMarks(buckets),
                ]}
                onCreate={zoom.onReady}
                data={data()}
                series={[
                  {},
                  { label: "Positive peak", stroke: chartTheme().seriesMax, width: 1 },
                  { label: "Negative peak", stroke: chartTheme().seriesMin, width: 1 },
                  { label: "RMS", stroke: chartTheme().seriesMean, width: 1.5 },
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
                  {
                    ...chartAxisStyle(),
                    label: "amplitude",
                    size: Y_AXIS_SIZE,
                    space: Y_AXIS_SPACE,
                  },
                ]}
              />
            </Show>
          </Show>
        </UplotChartPlot>
        <div
          class="spectrogram-canvas signal-diagnostic-spectrogram"
          ref={heatmap.attachWrap}
          {...spectrogramReveal.attach}
        >
          <canvas
            ref={heatmap.attachCanvas}
            onPointerDown={heatmap.onPointerDown}
            onPointerMove={heatmap.onPointerMove}
            onPointerUp={heatmap.onPointerUp}
            onPointerCancel={heatmap.onPointerUp}
            onPointerLeave={heatmap.onPointerLeave}
            onContextMenu={heatmap.onContextMenu}
          />
          <Show when={spectrogram.result()} fallback={<NoAudioState overlay />}>
            <Show when={hasFrameData(spectrogram.result())}>
              <ZoomChrome zoom={heatmapChrome()} revealed={spectrogramReveal.revealed()} />
            </Show>
          </Show>
        </div>
      </div>
      <ChartLegend entries={legend()} note={frequencyScaleLabel(frequencyScale())} />
    </div>
  );
}
