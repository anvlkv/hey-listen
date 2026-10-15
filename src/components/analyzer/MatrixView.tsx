import { createEffect, createMemo, Show, untrack } from "solid-js";
import Readout from "./Readout";
import ReframeMenu from "./ReframeMenu";
import ZoomControls from "./ZoomControls";
import { clamp01 } from "./colormap";
import { NoAudioState } from "./chartCommon";
import { createChartInteraction } from "./chartInteraction";
import {
  beginFrame,
  blitHeatmap,
  buildHeatmapImage,
  drawHoverCross,
  drawMirrorCursor,
  drawNoteOverlay,
  drawTimeAxis,
} from "./chartCanvas";
import {
  clampTimeRange,
  frameIndex,
  hasFrameData,
  type ChartView,
  type PlotBox,
} from "./chartGeometry";
import { chartTheme, resolvedTheme } from "../../state/themes";
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
  return { t0: 0, t1: Math.max(result.duration, 1e-6) };
}

function clampView(next: View, result: MatrixResult): View {
  const [t0, t1] = clampTimeRange(next.t0, next.t1, result.duration);
  return { t0, t1 };
}

/**
 * Generic matrix heatmap (M5): a frame × band result (mel spectrogram, MFCC,
 * chromagram, spectral contrast) drawn with time on the horizontal axis and the
 * band (labelled per tool) on the vertical, colour for value. Wheel zooms time,
 * drag pans; the visible time range is synced across analyzer tabs on the
 * `"time"` group. See `docs/analysis-tools.md`.
 */
export default function MatrixView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const config = () => analyzerById(props.id).view as MatrixViewConfig;
  const result = () => props.analysis.result() as MatrixResult | null;

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
      const frame = frameIndex(geo.time, value.duration, value.frames);
      return {
        time: geo.time,
        band,
        value: value.values[frame * value.bins + band],
        x: geo.x,
        y: geo.y,
      };
    },
  });

  /** Offscreen frames×bins image (time ×, band ↑), rebuilt on data change. */
  const image = createMemo<HTMLCanvasElement | null>(() => {
    const value = result();
    if (!value || value.bins === 0 || value.frames === 0) return null;
    const { bins, frames } = value;
    const lo = value.minValue;
    const hi = Math.max(value.maxValue, lo + 1e-3);
    const span = hi - lo;
    // Time runs horizontally, band vertically.
    return buildHeatmapImage(frames, bins, lo, span, (x, row) => value.values[x * bins + row]);
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
    const sx = clamp01(v.t0 / duration) * value.frames;
    const sw = Math.max(1e-6, (v.t1 - v.t0) / duration) * value.frames;

    blitHeatmap(ctx, off, sx, 0, sw, value.bins, box);

    if (config().noteGrid) drawNoteGrid(ctx, value, box);
    drawBands(ctx, value, box);
    drawTimeAxis(ctx, v, box);
    drawHoverCross(ctx, box, chart.hover());
    drawMirrorCursor(ctx, v, box, props.id);
    drawNoteOverlay(ctx, v, box, props.id);
  }

  /** Pitch-class row rules (chromagram note grid). */
  function drawNoteGrid(ctx: CanvasRenderingContext2D, value: MatrixResult, box: PlotBox) {
    if (value.bins < 2) return;
    ctx.save();
    ctx.strokeStyle = chartTheme().grid;
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

  function drawBands(ctx: CanvasRenderingContext2D, value: MatrixResult, box: PlotBox) {
    if (value.bins === 0) return;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = chartTheme().axis;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const band = Math.round(frac * (value.bins - 1));
      const y = box.y + box.height - frac * box.height;
      ctx.fillText(config().formatBand(band), box.x - 6, y);
    }
    ctx.textAlign = "left";
  }

  createEffect(() => {
    // Track everything the canvas draws (theme included, so a theme switch redraws).
    resolvedTheme();
    image();
    chart.size();
    chart.hover();
    chart.view();
    draw();
  });

  const hasGrid = () => hasFrameData(result());

  return (
    <div class="analyzer-chart">
      <div class="analyzer-readouts">
        {/* Every entry is rendered upfront (with a placeholder) so the bar has a
            stable, reserved height instead of changing as the cursor moves. */}
        <Readout label="Time" value={chart.hover() ? `${chart.hover()!.time.toFixed(3)} s` : "—"} />
        <Readout
          label={config().yLabel}
          value={chart.hover() ? config().formatBand(chart.hover()!.band) : "—"}
        />
        <Readout
          label="Value"
          value={chart.hover() ? config().formatValue(chart.hover()!.value) : "—"}
        />
        <Readout label="Grid" value={result() ? `${result()!.frames} × ${result()!.bins}` : "—"} />
        <Readout
          label="Range"
          value={
            result()
              ? `${config().formatValue(result()!.minValue)} … ${config().formatValue(result()!.maxValue)}`
              : "—"
          }
        />
        <Readout label="Rate" value={result() ? formatHz(result()!.sampleRate) : "—"} />
      </div>
      <div class="spectrogram-canvas" ref={chart.attachWrap}>
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
            <ZoomControls
              onZoomIn={chart.zoomIn}
              onZoomOut={chart.zoomOut}
              onFit={chart.fit}
              label={chart.zoomLabel()}
            />
          </Show>
        </Show>
      </div>
      <ReframeMenu target={chart.menu()} onClose={() => chart.setMenu(null)} tool={props.id} />
    </div>
  );
}
