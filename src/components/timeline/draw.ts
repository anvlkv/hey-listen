import { columnExtent, type ChannelPick, type Peaks } from "../../lib/waveform";
import { analyzerBus, readBusMessage } from "../../state/chartSync";
import { filteredSamples } from "../../state/filtered";
import { filterEnabled } from "../../state/graph";
import { noteSpan } from "../../lib/note";
import { focusedNoteId, notesSorted } from "../../state/notes";
import { notesPanelOpen } from "../../state/settings";
import { source } from "../../state/source";
import { chartTheme } from "../../state/themes";
import { viewEnd, viewStart, windowEnd, windowStart } from "../../state/timeline";
import { LABEL_GAP, MOVE_HANDLE_H, PLOT_PAD, RULER_H } from "./constants";
import { formatRulerTime, niceStep } from "./format";
import { NOTE_STRIP_H } from "../notes/strip";
import { drawLane, type LaneSelection } from "../notes/lane";

/**
 * The filtered overlay's opacity: 85% opaque, so the filtered envelope **blends with**
 * the raw waveform underneath (a tint on the signal, not a replacement for it) while
 * still reading clearly at a glance.
 */
const FILTERED_OVERLAY_ALPHA = 0.85;

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
  /** The span being dragged out in the note lane (for the live selection). */
  laneSelection: () => LaneSelection;
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
      ctx.globalAlpha = FILTERED_OVERLAY_ALPHA;
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
      ctx.globalAlpha = 1;
    }
  }

  drawRuler(ctx, w, deps);

  if (s) {
    // Whole-window move handle (edge handles drawn after so their grab tabs win).
    drawMoveHandle(ctx, ws, we, waveTop);
    drawHandle(ctx, ws, waveTop, waveH, t.series);
    drawHandle(ctx, we, waveTop, waveH, t.series);
  }

  drawNotes(ctx, waveTop, waveH, w, deps, !!s);
  drawChartCursor(ctx, deps.t2x, h);

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

/**
 * The note lane (M14): the strip along the bottom of the waveform where notes are
 * created, moved and resized. The lane's background and the live selection come from
 * `notes/lane.ts`; the notes are drawn on top — a **range** as a shaded span with a
 * handle on each edge, a **point** note as a single tab — with a full-height stem for
 * the focused one. A **closed rail** draws them dull (and never focuses one). See
 * `components/notes/lane.ts` and `docs/notes.md` → Surfacing.
 */
function drawNotes(
  ctx: CanvasRenderingContext2D,
  waveTop: number,
  waveH: number,
  w: number,
  deps: TimelineDrawDeps,
  hasSource: boolean,
): void {
  const list = notesSorted();
  const theme = chartTheme();
  const t2x = deps.t2x;
  const stripTop = waveTop + waveH - NOTE_STRIP_H;
  const geom = { xFor: t2x, top: stripTop, height: NOTE_STRIP_H, left: 0, right: w };
  drawLane(ctx, geom, {
    background: theme.ruler,
    color: theme.note,
    hintColor: theme.axis,
    hint: hasSource && list.length === 0 ? "Drag to add a note" : null,
    selection: deps.laneSelection(),
  });
  if (list.length === 0) return;
  const focusId = focusedNoteId();
  // A closed rail keeps the pins but quiets them (see `analyzer/notePlugins.ts`).
  const quiet = notesPanelOpen() ? 1 : 0.55;

  for (const note of list) {
    const span = noteSpan(note);
    const x0 = t2x(span.start);
    const x1 = t2x(span.end);
    if (Math.max(x0, x1) < -14 || Math.min(x0, x1) > w + 14) continue;
    const focused = note.id === focusId;
    const isRange = span.end > span.start;
    if (isRange) {
      ctx.globalAlpha = focused ? 0.22 : 0.12 * quiet;
      ctx.fillStyle = theme.note;
      ctx.fillRect(x0, waveTop, Math.max(1, x1 - x0), waveH);
      ctx.globalAlpha = 1;
    }
    const p0 = Math.round(x0);
    const p1 = Math.round(x1);
    // A faint stem up out of the lane (full height for the focused note) so the anchor
    // is still readable against the waveform; a focused range also rules its end.
    ctx.globalAlpha = focused ? 1 : 0.7 * quiet;
    ctx.strokeStyle = theme.note;
    ctx.lineWidth = focused ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(p0 + 0.5, focused ? waveTop : stripTop - 7);
    ctx.lineTo(p0 + 0.5, stripTop + 0.5);
    if (isRange && focused) {
      ctx.moveTo(p1 + 0.5, waveTop);
      ctx.lineTo(p1 + 0.5, stripTop + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = focused ? 1 : 0.85 * quiet;
    ctx.fillStyle = theme.note;
    if (isRange) {
      // The span bar between two grab handles, one per edge.
      ctx.fillRect(p0, stripTop + 4, Math.max(1, p1 - p0), 3);
      ctx.fillRect(p0 - 3, stripTop + 1, 6, NOTE_STRIP_H - 2);
      ctx.fillRect(p1 - 3, stripTop + 1, 6, NOTE_STRIP_H - 2);
    } else {
      const cap = focused ? 8 : 6;
      ctx.fillRect(p0 - 1, stripTop + 1, 2, NOTE_STRIP_H - 2);
      ctx.fillRect(p0 - cap / 2, stripTop + 1, cap, 3);
    }
    ctx.globalAlpha = 1;
  }
}
