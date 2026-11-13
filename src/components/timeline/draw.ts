import { columnExtent, type Peaks } from "../../lib/waveform";
import { analyzerBus, readBusMessage } from "../../state/chartSync";
import { filteredSamples } from "../../state/filtered";
import { filterActive } from "../../state/graph";
import { source } from "../../state/source";
import { chartTheme } from "../../state/themes";
import { viewEnd, viewStart, windowEnd, windowStart } from "../../state/timeline";
import { LABEL_GAP, MOVE_HANDLE_H, PLOT_PAD, RULER_H } from "./constants";
import { formatRulerTime, formatTime, niceStep } from "./format";
import { drawWaveformLanes } from "./waveformLanes";
import { drawTimelineAnnotations } from "./annotationOverlay";
import type { LaneHandleDrag, LaneSelection } from "../annotations/lane";

/**
 * The filtered overlay's opacity: 85% opaque, so the filtered envelope **blends with**
 * the raw waveform underneath (a tint on the signal, not a replacement for it) while
 * still reading clearly at a glance.
 */
const FILTERED_OVERLAY_ALPHA = 0.85;

/**
 * Canvas painting for the Timeline. `drawTimeline` is the entry point (called by
 * `Timeline.tsx` from its repaint effect); the ruler, handle and move-handle helpers are
 * module-private, and the annotation lane/rules live in [`annotationOverlay.ts`](./annotationOverlay.ts).
 * The component-local values arrive as accessors in [`TimelineDrawDeps`] so every read still
 * happens inside the caller's reactive scope — the same tracking the inline `draw()` had.
 */
export interface TimelineDrawDeps {
  cssW: () => number;
  cssH: () => number;
  filteredPeaks: () => Peaks | null;
  /** One envelope per source channel, in channel order (see `lib/waveform.ts`). */
  channelPeaks: () => Peaks[];
  /** Width of the channel rail on the left (`0` for a mono source). */
  railW: () => number;
  playSec: () => number | null;
  /** Whether the playhead is live (a paused/stopped line is drawn dimmed). */
  playSecPlaying: () => boolean;
  t2x: (t: number) => number;
  x2t: (x: number) => number;
  span: () => number;
  plotW: () => number;
  /** The span being dragged out in the annotation lane (for the live selection). */
  laneSelection: () => LaneSelection;
  /** The annotation handle being dragged (for the moving edge and its ghost). */
  laneDrag: () => LaneHandleDrag | null;
  /** The annotation the pointer is over in the lane (drawn promoted). */
  laneHover: () => string | null;
}

/**
 * Paint the whole timeline: background, waveform (raw plus the filtered overlay),
 * ruler, annotation lane/rules, window handles and the playhead.
 */
export function drawTimeline(ctx: CanvasRenderingContext2D | null, deps: TimelineDrawDeps): void {
  const w = deps.cssW();
  const h = deps.cssH();
  if (!ctx || w <= 0 || h <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const waveTop = RULER_H;
  const waveH = h - RULER_H;
  const t = chartTheme();

  ctx.fillStyle = t.background;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = t.surface;
  ctx.fillRect(0, waveTop, w, waveH);

  const s = source();
  const ws = deps.t2x(windowStart());
  const we = deps.t2x(windowEnd());

  // Analysis window shading.
  if (s) {
    ctx.fillStyle = t.waveFill;
    ctx.fillRect(ws, waveTop, we - ws, waveH);
  }

  // Waveform: one lane per source channel, right of the channel rail.
  if (s && s.frames > 0) {
    const left = PLOT_PAD + deps.railW();
    const right = w - PLOT_PAD;
    drawWaveformLanes(
      ctx,
      {
        top: waveTop,
        height: waveH,
        left,
        right,
        samples: s.samples,
        frames: s.frames,
        channels: s.channels,
        sampleRate: s.sampleRate,
        peaks: deps.channelPeaks(),
      },
      { wave: t.series, midline: t.midline },
      deps.x2t,
    );

    // Filtered overlay: the same envelope, drawn over the lanes in a warm colour so
    // the filter's effect is visible. Mono, at the source rate, across the whole area.
    const fp = deps.filteredPeaks();
    const fsamp = filteredSamples();
    if (filterActive() && fp && fsamp && fsamp.length > 0) {
      const mid = waveTop + waveH / 2;
      const half = (waveH / 2) * 0.94;
      ctx.globalAlpha = FILTERED_OVERLAY_ALPHA;
      ctx.strokeStyle = t.filtered;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = left; x < right; x++) {
        const f0 = deps.x2t(x) * s.sampleRate;
        const f1 = deps.x2t(x + 1) * s.sampleRate;
        const [flo, fhi] = columnExtent(fp, fsamp, fsamp.length, 1, f0, f1, "mix");
        const fyHi = mid - fhi * half;
        const fyLo = mid - flo * half;
        ctx.moveTo(x + 0.5, Math.min(fyHi, fyLo));
        ctx.lineTo(x + 0.5, Math.max(fyHi, fyLo) + 0.5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawRuler(ctx, w, deps);

  // Annotation rules stay under the window handles and the playhead (M23), so the
  // window stays the loudest mark on the canvas.
  drawTimelineAnnotations(ctx, {
    waveTop,
    waveH,
    width: w,
    t2x: deps.t2x,
    hasSource: !!s,
    selection: deps.laneSelection(),
    drag: deps.laneDrag(),
    hovered: deps.laneHover(),
  });

  if (s) {
    // Whole-window move handle (edge handles drawn after so their grab tabs win).
    drawMoveHandle(ctx, ws, we, waveTop);
    drawHandle(ctx, ws, waveTop, waveH, t.series);
    drawHandle(ctx, we, waveTop, waveH, t.series);
  }

  drawChartCursor(ctx, deps.t2x, h);

  const ph = deps.playSec();
  if (ph != null) {
    const x = deps.t2x(ph);
    ctx.save();
    ctx.globalAlpha = deps.playSecPlaying() ? 1 : 0.45;
    ctx.strokeStyle = t.playhead;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, waveTop);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
    ctx.restore();
  }
}

/** The ruler strip: background, baseline, and non-colliding time labels. */
function drawRuler(ctx: CanvasRenderingContext2D, w: number, deps: TimelineDrawDeps): void {
  const theme = chartTheme();
  ctx.fillStyle = theme.ruler;
  ctx.fillRect(0, 0, w, RULER_H);
  ctx.strokeStyle = theme.grid;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H - 0.5);
  ctx.lineTo(w, RULER_H - 0.5);
  ctx.stroke();

  const s = deps.span();
  const step = niceStep(s, deps.plotW());
  const first = Math.ceil(viewStart() / step) * step;
  ctx.fillStyle = theme.axis;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // Track the right edge of the last drawn label so neighbouring labels never
  // collide; a label that would overlap is skipped (its tick is still drawn).
  let lastRight = -Infinity;
  for (let t = first; t <= viewEnd() + 1e-9; t += step) {
    const x = deps.t2x(t);
    ctx.strokeStyle = theme.rulerTick;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, RULER_H - 6);
    ctx.lineTo(x + 0.5, RULER_H);
    ctx.stroke();

    const label = formatRulerTime(t, s);
    const width = ctx.measureText(label).width;
    // Prefer the label to the right of its tick; flip it left near the edge.
    let lx = x + 4;
    if (lx + width > w) lx = x - 4 - width;
    if (lx < lastRight + LABEL_GAP) continue;
    ctx.fillText(label, lx, RULER_H / 2);
    lastRight = lx + width;
  }
}

/** A vertical start/end handle with a wider grab tab at the top. */
function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  height: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + height);
  ctx.stroke();

  // Wider grab tab at the top of the handle.
  ctx.fillStyle = color;
  ctx.fillRect(x - 4, top, 8, 12);
}

/** The grab bar spanning the window along the top of the waveform (move handle). */
function drawMoveHandle(ctx: CanvasRenderingContext2D, x0: number, x1: number, top: number): void {
  const w = x1 - x0;
  if (w <= 2) return;
  ctx.fillStyle = chartTheme().handleFill;
  ctx.fillRect(x0, top, w, MOVE_HANDLE_H);
  // Grip ridges so the bar reads as a draggable handle.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cx = Math.round((x0 + x1) / 2) + 0.5;
  for (let i = -1; i <= 1; i++) {
    const gx = cx + i * 4;
    ctx.moveTo(gx, top + 2);
    ctx.lineTo(gx, top + MOVE_HANDLE_H - 2);
  }
  ctx.stroke();

  // The window's Δ duration, readable without the toolbar (which keeps the full
  // `start – end · Δ` readout).
  ctx.fillStyle = chartTheme().axis;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatTime(windowEnd() - windowStart()), (x0 + x1) / 2, top + MOVE_HANDLE_H / 2);
}

/**
 * The hovered chart's cursor, mirrored onto the Timeline as a dashed rule — so the
 * moment a chart is pointing at is visible against the whole recording. Driven by the
 * shared `cursorSync` key (time group) that every analyzer chart publishes, and read
 * inside the repaint effect, so the Timeline follows the pointer.
 */
function drawChartCursor(
  ctx: CanvasRenderingContext2D,
  t2x: (t: number) => number,
  h: number,
): void {
  const message = readBusMessage(analyzerBus.data.cursorSync);
  if (!message || message.group !== "time" || message.x == null) return;
  const x = t2x(message.x);
  ctx.save();
  ctx.strokeStyle = chartTheme().mirror;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(Math.round(x) + 0.5, RULER_H);
  ctx.lineTo(Math.round(x) + 0.5, h);
  ctx.stroke();
  ctx.restore();
}
