import { createEffect, createMemo, Show, untrack } from "solid-js";
import Readout from "./Readout";
import ReframeMenu from "./ReframeMenu";
import HeatmapColorScale from "./HeatmapColorScale";
import { heatmapScale } from "./heatmapScale";
import { bandLabelRows, fitText, formatBandRange } from "./heatmapLabels";
import { clamp01 } from "./colormap";
import { ZoomChrome, createZoomReveal, NoAudioState, type ChartZoom } from "./chartCommon";
import { createChartInteraction } from "./chartInteraction";
import {
  beginFrame,
  blitHeatmap,
  buildHeatmapImage,
  drawHoverCross,
  drawMirrorCursor,
  drawAnnotationOverlay,
  drawPlayhead,
  drawTimeAxis,
} from "./chartCanvas";
import {
  clampTimeRange,
  frameIndex,
  hasFrameData,
  type ChartView,
  type PlotBox,
} from "./chartGeometry";
import { activeThemeId, chartTheme } from "../../state/themes";
import { useCanvasImage } from "./chartImage";
import {
  analyzerById,
  formatHz,
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type MatrixResult,
  type MatrixView as MatrixViewConfig,
} from "../../state/analyzer";

/** The visible time range (seconds). */
type View = ChartView;

interface Hover {
  time: number;
  band: number;
  value: number;
  x: number;
  y: number;
}

function fullView(result: MatrixResult): View {
  return { t0: result.windowStart, t1: result.windowStart + Math.max(result.duration, 1e-6) };
}

function clampView(next: View, result: MatrixResult): View {
  const [t0, t1] = clampTimeRange(next.t0, next.t1, result.windowStart, result.duration);
  return { t0, t1 };
}

/**
 * Generic matrix heatmap (M5): a frame × band result (mel spectrogram, MFCC,
 * chromagram, spectral contrast, critical bands, specific loudness) drawn with time on
 * the horizontal axis and the band (labelled per tool) on the vertical, colour for
 * value.
 *
 * Every matrix declares its colour semantics (M36) — value label, domain, transform,
 * axis model — and one [`HeatmapScale`](./heatmapScale.ts) is resolved from them, so
 * the image and its colourbar share the exact domain, transform and ramp. Band rows are
 * labelled by density (a 12-row chromagram names every pitch class; a 64-band mel names
 * a stride of them), and a band's readout and label show its real low–high range when
 * the result — or the descriptor — carries the edges.
 *
 * Wheel zooms time, drag pans; the visible time range is synced across analyzer tabs on
 * the `"time"` group. See `docs/analysis-tools.md`.
 */
export default function MatrixView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const config = () => analyzerById(props.id).view as MatrixViewConfig;
  const result = () => props.analysis.result() as MatrixResult | null;

  /** The band's exact low/high edges (Hz): the result's own, else the descriptor's. */
  const bandEdges = (value: MatrixResult): number[] | null => {
    const raw = value.bandEdges;
    if (raw && raw.length >= value.bins + 1) return raw;
    const declared = config().bandEdges;
    const list = typeof declared === "function" ? declared(value.bins) : declared;
    return list && list.length >= value.bins + 1 ? list : null;
  };

  /** A band row's label: its exact range, else the band axis value / row index. */
  const bandLabel = (band: number): string => {
    const value = result();
    if (!value) return config().formatBand(band);
    const edges = bandEdges(value);
    if (edges) return formatBandRange(edges[band], edges[band + 1]);
    const position = config().bandAxisIsValue ? (value.bands[band] ?? band) : band;
    return config().formatBand(position);
  };

  /** The calibration readout for a matrix tool that carries one (specific loudness). */
  const calibrationLabel = (): string => {
    const r = result();
    if (!r) return "—";
    return r.calibrated ? `${r.calibrationDbSpl.toFixed(1)} dB SPL` : "uncalibrated";
  };

  /**
   * The colour scale both the image and its colourbar use (M36): the result's own
   * domain / unit, the descriptor's colour semantics, and the theme's ramp.
   */
  const heatmap = createMemo(() => {
    const value = result();
    return value ? heatmapScale(value, config()) : null;
  });

  /** The colourbar's caption: what the values are, and whether they are normalized. */
  const colorLabel = (): string => {
    const base = config().valueLabel;
    const r = result();
    return r?.normalized ? `${base} · normalized` : base;
  };

  const chart = createChartInteraction<View, Hover, MatrixResult>({
    // A tab's id is fixed for its lifetime, so the interaction is built once (untracked).
    id: untrack(() => props.id),
    result,
    fullView,
    clampView,
    applyShared: (_current, x, value) => clampView({ t0: x[0], t1: x[1] }, value),
    pan: (v, dxFrac) => {
      const dt = dxFrac * (v.t1 - v.t0);
      return { t0: v.t0 - dt, t1: v.t1 - dt };
    },
    wheel: (v, xFrac, _yFrac, factor) => {
      const at = v.t0 + xFrac * (v.t1 - v.t0);
      return {
        view: { t0: at + (v.t0 - at) * factor, t1: at + (v.t1 - at) * factor },
        publish: true,
      };
    },
    pick: (geo) => {
      const value = result();
      if (!value || value.frames === 0 || value.bins === 0) return null;
      const band = Math.min(value.bins - 1, Math.max(0, Math.round(geo.yFrac * (value.bins - 1))));
      const frame = frameIndex(geo.time, value.windowStart, value.duration, value.frames);
      return {
        time: geo.time,
        band,
        value: value.values[frame * value.bins + band],
        x: geo.x,
        y: geo.y,
      };
    },
  });

  // Export the rendered heatmap (M12).
  useCanvasImage(() => props.id, chart.canvas);

  /** Offscreen frames×bins image (time ×, band ↑), rebuilt on data change. */
  const image = createMemo<HTMLCanvasElement | null>(() => {
    const value = result();
    const scale = heatmap();
    if (!value || !scale || value.bins === 0 || value.frames === 0) return null;
    const { bins, frames } = value;
    // Time runs horizontally, band vertically. The scale maps the value onto the ramp
    // (through its declared transform and its own stops), so the bar and the pixels share
    // one denominator *and* one colour ramp.
    return buildHeatmapImage(
      frames,
      bins,
      0,
      1,
      (x, row) => scale.position(value.values[x * bins + row]),
      scale.ramp,
    );
  });

  function draw() {
    const { width, height } = chart.size();
    const ctx = beginFrame(chart.canvas(), width, height);
    if (!ctx) return;

    const value = result();
    const v = chart.view();
    const off = image();
    const box = chart.box();
    if (!value || !off || !v) return;

    const duration = Math.max(value.duration, 1e-9);
    const sx = clamp01((v.t0 - value.windowStart) / duration) * value.frames;
    const sw = Math.max(1e-6, (v.t1 - v.t0) / duration) * value.frames;

    blitHeatmap(ctx, off, sx, 0, sw, value.bins, box);

    if (config().noteGrid) drawNoteGrid(ctx, value, box);
    drawBands(ctx, value, box);
    drawTimeAxis(ctx, v, box);
    drawHoverCross(ctx, box, chart.hover());
    drawMirrorCursor(ctx, v, box, props.id);
    // Read inside `draw` so the repaint effect below tracks the transport position.
    drawPlayhead(ctx, v, box);
    drawAnnotationOverlay(ctx, v, box, props.id, chart.selection());
  }

  /** Pitch-class row rules (chromagram annotation grid). */
  function drawNoteGrid(ctx: CanvasRenderingContext2D, value: MatrixResult, box: PlotBox) {
    if (value.bins < 2) return;
    ctx.save();
    // The pitch-class rules are a grid, so they take the faint role: the colour is the
    // pitch class, and a full-strength grid would compete with it (M36).
    ctx.strokeStyle = chartTheme().gridFaint;
    ctx.lineWidth = 1;
    for (let row = 1; row < value.bins; row++) {
      const y = Math.round(box.y + box.height - (row / value.bins) * box.height) + 0.5;
      ctx.beginPath();
      ctx.moveTo(box.x, y);
      ctx.lineTo(box.x + box.width, y);
      ctx.stroke();
    }
    // Emphasise the octave boundary between pitch class C and C#.
    const yc = Math.round(box.y + box.height - (1 / value.bins) * box.height) + 0.5;
    ctx.strokeStyle = chartTheme().axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(box.x, yc);
    ctx.lineTo(box.x + box.width, yc);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Band labels down the left edge, one per row when they fit and a stride otherwise —
   * density-aware rather than a fixed five, so a chromagram names all twelve pitch
   * classes and a 64-band mel stays legible.
   */
  function drawBands(ctx: CanvasRenderingContext2D, value: MatrixResult, box: PlotBox) {
    if (value.bins === 0) return;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = chartTheme().axis;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    const maxWidth = box.x - 8;
    for (const band of bandLabelRows(value.bins, box.height, config().labelEveryBand)) {
      const y = box.y + box.height - ((band + 0.5) / value.bins) * box.height;
      const label = fitText(ctx, bandLabel(band), maxWidth);
      ctx.fillText(label, box.x - 6, y);
    }
    ctx.textAlign = "left";
  }

  createEffect(() => {
    // Track everything the canvas draws (the active theme and the preview playhead
    // included, so any theme switch and the transport both repaint). Keyed on the theme
    // **id**, not just its base: two themes on the same base still recolour the canvas.
    activeThemeId();
    image();
    chart.size();
    chart.hover();
    chart.view();
    draw();
  });

  const hasGrid = () => hasFrameData(result());
  const modelLabel = () => result()?.model ?? config().axisModel;

  /** The zoom chrome only while the chart is in use (M36). */
  const reveal = createZoomReveal(() => !chart.atFit());
  const zoomChrome = (): ChartZoom => ({
    zoomIn: chart.zoomIn,
    zoomOut: chart.zoomOut,
    fit: chart.fit,
    label: chart.zoomLabel(),
  });

  return (
    <div class="analyzer-chart">
      <div class="analyzer-readouts">
        {/* Every entry is rendered upfront (with a placeholder) so the bar has a
            stable, reserved height instead of changing as the cursor moves. */}
        <Readout label="Time" value={chart.hover() ? `${chart.hover()!.time.toFixed(3)} s` : "—"} />
        <Readout
          label={config().yLabel}
          value={chart.hover() ? bandLabel(chart.hover()!.band) : "—"}
        />
        <Readout
          label="Value"
          value={chart.hover() ? config().formatValue(chart.hover()!.value) : "—"}
          title={config().valueLabel}
        />
        <Readout label="Grid" value={result() ? `${result()!.frames} × ${result()!.bins}` : "—"} />
        <Readout
          label="Scale"
          value={
            heatmap()
              ? `${heatmap()!.formatter(heatmap()!.min)} … ${heatmap()!.formatter(heatmap()!.max)}`
              : "—"
          }
          title="The colour scale's domain — exactly what the pixels and the colourbar span"
        />
        <Readout label="Rate" value={result() ? formatHz(result()!.sampleRate) : "—"} />
        <Show when={modelLabel()}>
          {(model) => (
            <Readout
              label="Model"
              value={model()}
              title="The band-axis / value model the result reports"
            />
          )}
        </Show>
        <Show when={result()?.unit}>
          <Readout
            label="Calibration"
            value={calibrationLabel()}
            title="dB SPL of a full-scale sine; 'uncalibrated' leaves the values relative"
          />
        </Show>
      </div>
      <div class="spectrogram-canvas" ref={chart.attachWrap} {...reveal.attach}>
        <canvas
          ref={chart.attachCanvas}
          onPointerDown={chart.onPointerDown}
          onPointerMove={chart.onPointerMove}
          onPointerUp={chart.onPointerUp}
          onPointerCancel={chart.onPointerUp}
          onPointerLeave={chart.onPointerLeave}
          onContextMenu={chart.onContextMenu}
        />
        <Show when={result()} fallback={<NoAudioState overlay />}>
          <Show
            when={hasGrid()}
            fallback={
              <div class="analyzer-empty analyzer-empty-overlay">
                No values in this window — widen the analysis window or lower the FFT size.
              </div>
            }
          >
            <ZoomChrome zoom={zoomChrome()} revealed={reveal.revealed()} />
          </Show>
        </Show>
      </div>
      <Show when={heatmap()}>
        {(scale) => <HeatmapColorScale scale={scale()} label={colorLabel()} />}
      </Show>
      <ReframeMenu target={chart.menu()} onClose={() => chart.setMenu(null)} tool={props.id} />
    </div>
  );
}
