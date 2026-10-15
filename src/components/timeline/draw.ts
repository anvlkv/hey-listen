import { columnExtent, type ChannelPick, type Peaks } from "../../lib/waveform";
import { filteredSamples } from "../../state/filtered";
import { filterEnabled } from "../../state/graph";
import { focusedNoteId, notesSorted } from "../../state/notes";
import { source } from "../../state/source";
import { chartTheme } from "../../state/themes";
import { viewEnd, viewStart, windowEnd, windowStart } from "../../state/timeline";
import { LABEL_GAP, MOVE_HANDLE_H, PLOT_PAD, RULER_H } from "./constants";
import { formatRulerTime, niceStep } from "./format";

/**
 * Canvas painting for the Timeline. `drawTimeline` is the entry point (called by
 * `Timeline.tsx` from its repaint effect); the ruler, handle, move-handle and note
 * helpers are module-private. The component-local values arrive as accessors in
 * [`TimelineDrawDeps`] so every read still happens inside the caller's reactive
 * scope — the same tracking the inline `draw()` had.
 */
export interface TimelineDrawDeps {
  cssW: () => number;
  cssH: () => number;
  peaks: () => Peaks | null;
  filteredPeaks: () => Peaks | null;
  pick: () => ChannelPick;
  playSec: () => number | null;
  t2x: (t: number) => number;
  x2t: (x: number) => number;
  span: () => number;
  plotW: () => number;
}

/**
 * Paint the whole timeline: background, waveform (raw plus the filtered overlay),
 * ruler, window handles, note pins and the playhead.
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

  // Waveform.
  if (s && s.frames > 0) {
    const mid = waveTop + waveH / 2;
    const half = (waveH / 2) * 0.94;
    const p = deps.peaks();
    const x0 = PLOT_PAD;
    const x1 = w - PLOT_PAD;
    ctx.strokeStyle = t.series;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < x1; x++) {
      const f0 = deps.x2t(x) * s.sampleRate;
      const f1 = deps.x2t(x + 1) * s.sampleRate;
      const [lo, hi] = columnExtent(p, s.samples, s.frames, s.channels, f0, f1, deps.pick());
      const yHi = mid - hi * half;
      const yLo = mid - lo * half;
      ctx.moveTo(x + 0.5, Math.min(yHi, yLo));
      ctx.lineTo(x + 0.5, Math.max(yHi, yLo) + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = t.midline;
    ctx.beginPath();
    ctx.moveTo(x0, mid + 0.5);
    ctx.lineTo(x1, mid + 0.5);
    ctx.stroke();

    // Filtered overlay: the same envelope, drawn over the raw waveform in a
    // warm colour so the filter's effect is visible. Mono, at the source rate.
    const fp = deps.filteredPeaks();
    const fsamp = filteredSamples();
    if (filterEnabled() && fp && fsamp && fsamp.length > 0) {
      ctx.strokeStyle = t.filtered;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x < x1; x++) {
        const f0 = deps.x2t(x) * s.sampleRate;
        const f1 = deps.x2t(x + 1) * s.sampleRate;
        const [flo, fhi] = columnExtent(fp, fsamp, fsamp.length, 1, f0, f1, "mix");
        const fyHi = mid - fhi * half;
        const fyLo = mid - flo * half;
        ctx.moveTo(x + 0.5, Math.min(fyHi, fyLo));
        ctx.lineTo(x + 0.5, Math.max(fyHi, fyLo) + 0.5);
      }
      ctx.stroke();
    }
  }

  drawRuler(ctx, w, deps);

  if (s) {
    // Whole-window move handle (edge handles drawn after so their grab tabs win).
    drawMoveHandle(ctx, ws, we, waveTop);
    drawHandle(ctx, ws, waveTop, waveH, t.series);
    drawHandle(ctx, we, waveTop, waveH, t.series);
  }

  drawNotes(ctx, waveTop, waveH, w, deps.t2x);

  const ph = deps.playSec();
  if (ph != null) {
    const x = deps.t2x(ph);
    ctx.strokeStyle = t.playhead;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, waveTop);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
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
}

/**
 * Note pins (M14): every note is a triangle at its time (a shaded span for a
 * range); the focused note is emphasised with a full-height stem. Clicking a pin
 * focuses the note; hovering shows a hint. See `docs/notes.md` → Surfacing.
 */
function drawNotes(
  ctx: CanvasRenderingContext2D,
  waveTop: number,
  waveH: number,
  w: number,
  t2x: (t: number) => number,
): void {
  const list = notesSorted();
  if (list.length === 0) return;
  const theme = chartTheme();
  const focusId = focusedNoteId();
  for (const note of list) {
    const x = t2x(note.timeSecs);
    if (x < -12 || x > w + 12) continue;
    const focused = note.id === focusId;
    if (note.range) {
      const x0 = t2x(note.range.startSecs);
      const x1 = t2x(note.range.endSecs);
      ctx.globalAlpha = focused ? 0.22 : 0.12;
      ctx.fillStyle = theme.note;
      ctx.fillRect(x0, waveTop, Math.max(1, x1 - x0), waveH);
      ctx.globalAlpha = 1;
    }
    const size = focused ? 6 : 4;
    ctx.globalAlpha = focused ? 1 : 0.8;
    ctx.fillStyle = theme.note;
    ctx.beginPath();
    ctx.moveTo(x - size, waveTop);
    ctx.lineTo(x + size, waveTop);
    ctx.lineTo(x, waveTop + size + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = theme.note;
    ctx.lineWidth = focused ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, waveTop);
    ctx.lineTo(Math.round(x) + 0.5, waveTop + (focused ? waveH : 10));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
