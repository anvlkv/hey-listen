import { createMemo } from "solid-js";
import { createChartInteraction, type ChartInteraction } from "./chartInteraction";
import {
  beginFrame,
  blitHeatmap,
  drawAnnotationOverlay,
  drawHoverCross,
  drawMirrorCursor,
  drawPlayhead,
  drawTimeAxis,
} from "./chartCanvas";
import {
  binAt,
  drawContours,
  drawFrequencyAxis,
  spectrogramImage,
  spectrogramOverlays,
  visibleRows,
  type ContourToggles,
  type PitchOverlay,
  type SpectrogramOverlays,
} from "./spectrogramRender";
import {
  clampView,
  freqAtFrac,
  fullView,
  panBand,
  zoomBand,
  type SpectrogramWindow,
} from "./spectrogramView";
import { clamp01 } from "./colormap";
import { resolveHeatmapScale, type HeatmapScale } from "./heatmapScale";
import { frameIndex } from "./chartGeometry";
import type { FrequencyScale } from "./frequencyScale";
import type { SpectrogramResult } from "../../state/analyzer";

/**
 * The spectrogram canvas as one reusable unit: the pan / wheel-zoom / lane interaction,
 * the level image, the contours, and the paint pass. Shared by the `spectrogram` tab and
 * the linked waveform-over-spectrogram pair ([`SignalDiagnostic`](./SignalDiagnostic.tsx)),
 * so both canvases zoom, pick, and draw identically — one implementation, not two.
 *
 * The caller owns the result (its own `createAnalysis`), the dynamic range, the frequency
 * scale and the contour toggles, and runs [`SpectrogramCanvas.draw`] inside an effect that
 * tracks whatever it wants the repaint to follow.
 */

/** The visible spectrogram window: the shared time range plus the frequency band (Hz). */
export type SpectrogramView = SpectrogramWindow;

/** What the pointer reads under the cursor. */
export interface SpectrogramHover {
  time: number;
  freq: number;
  db: number;
  x: number;
  y: number;
}

export interface SpectrogramCanvasOptions {
  /** Stable id: the annotation tool and the `sourceId` published for time sync. */
  id: string;
  result: () => SpectrogramResult | null;
  /** Displayed dynamic range below the peak, in dB. */
  dbRange: () => number;
  /** The vertical frequency scale (view-only). */
  scale: () => FrequencyScale;
  /** Which contours to draw. */
  toggles: () => ContourToggles;
  /**
   * A composed F0 track for the same window (M36), or `null` while it is absent /
   * switched off. Never derived from the heatmap itself.
   */
  pitch?: () => PitchOverlay | null;
}

export interface SpectrogramCanvas {
  chart: ChartInteraction<SpectrogramView, SpectrogramHover>;
  /**
   * The level scale the heatmap and its colourbar share: `maxDb − dbRange … maxDb`.
   * `null` before a result exists.
   */
  levelScale: () => HeatmapScale | null;
  /** The per-frame overlay tracks, when the result has a grid. */
  overlays: () => SpectrogramOverlays | null;
  /** Paint the current frame (at the chart's cached size and view). */
  draw: () => void;
}

export function createSpectrogramCanvas(options: SpectrogramCanvasOptions): SpectrogramCanvas {
  const chart = createChartInteraction<SpectrogramView, SpectrogramHover, SpectrogramResult>({
    id: options.id,
    result: options.result,
    fullView,
    clampView,
    // Preserve the frequency window when another chart zooms the shared time range.
    applyShared: (current, x, result) =>
      current ? clampView({ ...current, t0: x[0], t1: x[1] }, result) : null,
    pan: (v, dxFrac, dyFrac) => {
      const dt = dxFrac * (v.t1 - v.t0);
      const band = panBand(v, dyFrac, options.scale());
      return { ...band, t0: v.t0 - dt, t1: v.t1 - dt };
    },
    wheel: (v, xFrac, yFrac, factor, shift) => {
      if (shift) {
        return { view: zoomBand(v, yFrac, factor, options.scale()), publish: false };
      }
      const at = v.t0 + xFrac * (v.t1 - v.t0);
      return {
        view: { ...v, t0: at + (v.t0 - at) * factor, t1: at + (v.t1 - at) * factor },
        publish: true,
      };
    },
    pick: (geo) => {
      const result = options.result();
      if (!result || result.frames === 0 || result.bins === 0) return null;
      const frame = frameIndex(geo.time, result.windowStart, result.duration, result.frames);
      const freq = freqAtFrac(geo.view, geo.yFrac, options.scale());
      const bin = binAt(result, freq);
      return {
        time: geo.time,
        freq: result.freqs[bin] ?? freq,
        db: result.magDb[frame * result.bins + bin],
        x: geo.x,
        y: geo.y,
      };
    },
  });

  const levelScale = createMemo<HeatmapScale | null>(() => {
    const result = options.result();
    if (!result) return null;
    return resolveHeatmapScale({
      min: result.maxDb - options.dbRange(),
      max: result.maxDb,
      unit: "dBFS",
    });
  });
  const image = createMemo(() => {
    const scale = levelScale();
    return scale ? spectrogramImage(options.result(), scale, options.scale()) : null;
  });
  const overlays = createMemo(() =>
    spectrogramOverlays(options.result(), options.pitch?.() ?? null),
  );

  function draw() {
    const { width, height } = chart.size();
    const ctx = beginFrame(chart.canvas(), width, height);
    if (!ctx) return;
    const result = options.result();
    const view = chart.view();
    const source = image();
    const box = chart.box();
    if (!result || !source || !view) return;
    const scale = options.scale();

    // The visible sub-rectangle of the source image (time ×, frequency ↑). The image's
    // rows are already in the display coordinate, so this is one plain blit.
    const duration = Math.max(result.duration, 1e-9);
    const sx = clamp01((view.t0 - result.windowStart) / duration) * result.frames;
    const sw = Math.max(1e-6, (view.t1 - view.t0) / duration) * result.frames;
    const { sy, sh } = visibleRows(result, view, scale);
    blitHeatmap(ctx, source, sx, sy, sw, sh, box);

    drawContours(
      ctx,
      view,
      box,
      result.windowStart,
      result.duration,
      overlays(),
      options.toggles(),
      scale,
    );
    drawFrequencyAxis(ctx, view, box, scale);
    drawTimeAxis(ctx, view, box);
    drawHoverCross(ctx, box, chart.hover());
    drawMirrorCursor(ctx, view, box, options.id);
    // Read inside `draw` so the caller's repaint effect tracks the transport position.
    drawPlayhead(ctx, view, box);
    drawAnnotationOverlay(ctx, view, box, options.id, chart.selection());
  }

  return { chart, levelScale, overlays, draw };
}
