import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { playhead, previewRegion, stop as stopPreview } from "../audio/preview";
import { columnExtent, computePeaks, type Peaks } from "../lib/waveform";
import { channelFor } from "../state/analysis";
import { filterEnabled } from "../state/graph";
import { filteredSamples } from "../state/filtered";
import { stopFollowing } from "../state/capture";
import { chartTheme } from "../state/settings";
import { source, status } from "../state/source";
import Button from "./Button";
import ChannelSelect from "./ChannelSelect";
import {
  setView,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "../state/timeline";

const RULER_H = 22;
const HANDLE_HIT = 9;
/** Horizontal gap (px) kept between consecutive ruler labels so they never collide. */
const LABEL_GAP = 8;
/** Vertical hit zone (px) at the top of the waveform for the window move handle. */
const MOVE_HIT = 10;
/** Height (px) of the drawn window move handle bar. */
const MOVE_HANDLE_H = 8;
/** Horizontal gutter so the start/end handles never sit on the very edge. */
const PLOT_PAD = 12;
/** Click-drag preview restart throttle, in ms. */
const PREVIEW_THROTTLE = 110;
/** Length of the excerpt auditioned while dragging a handle, in seconds. */
const EDGE_EXCERPT = 0.75;

const TICK_STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
  1800, 3600,
];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "–:––";
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const minutes = Math.floor(abs / 60);
  const secs = abs - minutes * 60;
  return `${sign}${minutes}:${secs.toFixed(2).padStart(5, "0")}`;
}

/**
 * Compact ruler label. The granularity follows the visible span so consecutive
 * ticks stay short enough not to collide: `h:mm:ss` for long spans, whole-second
 * `m:ss` from a minute up, and `ss.s` / finer for short spans.
 */
function formatRulerTime(seconds: number, visibleSpan: number): string {
  if (!Number.isFinite(seconds)) return "–:––";
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  const secs = Math.floor(abs % 60);
  if (hours > 0 || visibleSpan >= 3600) {
    return `${sign}${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  if (visibleSpan >= 60) {
    return `${sign}${minutes}:${secs.toString().padStart(2, "0")}`;
  }
  if (visibleSpan >= 1) return `${sign}${abs.toFixed(1)}`;
  if (visibleSpan >= 0.1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toFixed(3)}`;
}

function niceStep(span: number, width: number): number {
  const target = Math.max(1, width / 90);
  for (const step of TICK_STEPS) {
    if (span / step <= target) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

type DragKind = "start" | "end" | "move" | "pan";

/**
 * Timeline (fixed region): waveform of the whole source plus the draggable
 * analysis window.
 *
 * - Wheel zooms around the cursor, drag on the waveform pans, buttons fit /
 *   zoom-to-window.
 * - Dragging a `start`/`end` handle previews an excerpt at that edge; short
 *   windows auto-zoom on release (see `docs/source-model.md`).
 * - Dragging the grab bar along the top of the window moves the whole window,
 *   keeping its width (no preview, no auto-zoom).
 */
export default function Timeline() {
  let canvas!: HTMLCanvasElement;
  let wrap!: HTMLDivElement;

  const [cssW, setCssW] = createSignal(0);
  const [cssH, setCssH] = createSignal(0);
  const [playSec, setPlaySec] = createSignal<number | null>(null);
  const [previewing, setPreviewing] = createSignal(false);

  const duration = () => source()?.duration ?? 0;
  const span = () => Math.max(1e-9, viewEnd() - viewStart());
  const plotW = () => Math.max(1, cssW() - PLOT_PAD * 2);
  /** The timeline is interactive for a settled source or a growing capture. */
  const active = () => status() === "ready" || status() === "capturing";

  /** Analysis/display channel for the current source (see `state/analysis.ts`). */
  const pick = () => channelFor(source()?.channels ?? 1);

  const peaks = createMemo<Peaks | null>(() => {
    const s = source();
    if (!s) return null;
    const want = pick();
    // Live captures maintain their peaks incrementally; files compute them lazily.
    if (s.peaks && s.peaksChannel === want) return s.peaks;
    return computePeaks(s.samples, s.frames, s.channels, want);
  });

  /** Envelope of the filtered mono overlay (source rate; see `state/filtered.ts`). */
  const filteredPeaks = createMemo<Peaks | null>(() => {
    const f = filteredSamples();
    if (!f || f.length === 0) return null;
    return computePeaks(f, f.length, 1, "mix");
  });

  const t2x = (t: number) => PLOT_PAD + ((t - viewStart()) / span()) * plotW();
  const x2t = (x: number) => viewStart() + ((x - PLOT_PAD) / plotW()) * span();

  const clampView = (a: number, b: number): [number, number] => {
    const dur = duration();
    const minSpan = Math.min(dur, Math.max(1e-4, dur / 100_000));
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    if (hi - lo < minSpan) {
      const mid = (lo + hi) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    if (lo < 0) {
      hi = Math.min(dur, hi - lo);
      lo = 0;
    }
    if (hi > dur) {
      lo = Math.max(0, lo - (hi - dur));
      hi = dur;
    }
    return [Math.max(0, lo), Math.min(dur, hi)];
  };

  const applyView = (a: number, b: number) => {
    const [lo, hi] = clampView(a, b);
    setView(lo, hi);
  };

  // --- preview -----------------------------------------------------------

  let raf = 0;

  function tick() {
    raf = 0;
    if (!previewing()) return;
    const position = playhead();
    setPlaySec(position);
    // A null position means the core stopped (ended or failed) — end the preview.
    if (position == null) {
      endPreview();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function startPreview(a: number, b: number, loop: boolean) {
    previewRegion(a, b, loop);
    setPreviewing(true);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  /** Audition a short excerpt next to the handle being dragged. */
  function previewEdge(kind: "start" | "end") {
    const wLen = windowEnd() - windowStart();
    if (wLen <= 0) return;
    const len = Math.min(EDGE_EXCERPT, wLen);
    if (kind === "end") startPreview(windowEnd() - len, windowEnd(), true);
    else startPreview(windowStart(), windowStart() + len, true);
  }

  function endPreview() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    stopPreview();
    setPreviewing(false);
    setPlaySec(null);
  }

  function togglePreview() {
    if (previewing()) endPreview();
    else startPreview(windowStart(), windowEnd(), true);
  }

  // --- drawing -----------------------------------------------------------

  function draw() {
    const ctx = canvas?.getContext("2d");
    const w = cssW();
    const h = cssH();
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
    const ws = t2x(windowStart());
    const we = t2x(windowEnd());

    // Analysis window shading.
    if (s) {
      ctx.fillStyle = t.waveFill;
      ctx.fillRect(ws, waveTop, we - ws, waveH);
    }

    // Waveform.
    if (s && s.frames > 0) {
      const mid = waveTop + waveH / 2;
      const half = (waveH / 2) * 0.94;
      const p = peaks();
      const x0 = PLOT_PAD;
      const x1 = w - PLOT_PAD;
      ctx.strokeStyle = t.series;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x < x1; x++) {
        const f0 = x2t(x) * s.sampleRate;
        const f1 = x2t(x + 1) * s.sampleRate;
        const [lo, hi] = columnExtent(p, s.samples, s.frames, s.channels, f0, f1, pick());
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
      const fp = filteredPeaks();
      const fsamp = filteredSamples();
      if (filterEnabled() && fp && fsamp && fsamp.length > 0) {
        ctx.strokeStyle = t.filtered;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = x0; x < x1; x++) {
          const f0 = x2t(x) * s.sampleRate;
          const f1 = x2t(x + 1) * s.sampleRate;
          const [flo, fhi] = columnExtent(fp, fsamp, fsamp.length, 1, f0, f1, "mix");
          const fyHi = mid - fhi * half;
          const fyLo = mid - flo * half;
          ctx.moveTo(x + 0.5, Math.min(fyHi, fyLo));
          ctx.lineTo(x + 0.5, Math.max(fyHi, fyLo) + 0.5);
        }
        ctx.stroke();
      }
    }

    drawRuler(ctx, w);

    if (s) {
      // Whole-window move handle (edge handles drawn after so their grab tabs win).
      drawMoveHandle(ctx, ws, we, waveTop);
      drawHandle(ctx, ws, waveTop, waveH, t.series);
      drawHandle(ctx, we, waveTop, waveH, t.series);
    }

    const ph = playSec();
    if (ph != null) {
      const x = t2x(ph);
      ctx.strokeStyle = t.playhead;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, waveTop);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
  }

  function drawRuler(ctx: CanvasRenderingContext2D, w: number) {
    const theme = chartTheme();
    ctx.fillStyle = theme.ruler;
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(w, RULER_H - 0.5);
    ctx.stroke();

    const s = span();
    const step = niceStep(s, plotW());
    const first = Math.ceil(viewStart() / step) * step;
    ctx.fillStyle = theme.axis;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Track the right edge of the last drawn label so neighbouring labels never
    // collide; a label that would overlap is skipped (its tick is still drawn).
    let lastRight = -Infinity;
    for (let t = first; t <= viewEnd() + 1e-9; t += step) {
      const x = t2x(t);
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

  function drawHandle(
    ctx: CanvasRenderingContext2D,
    x: number,
    top: number,
    height: number,
    color: string,
  ) {
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

  /** Grab bar spanning the window along the top of the waveform (move handle). */
  function drawMoveHandle(
    ctx: CanvasRenderingContext2D,
    x0: number,
    x1: number,
    top: number,
  ) {
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

  // --- interaction -------------------------------------------------------

  let drag: {
    kind: DragKind;
    pointerX: number;
    origViewStart: number;
    origViewEnd: number;
    origWindowStart: number;
    origWindowEnd: number;
  } | null = null;
  let lastPreview = 0;

  function pointerX(e: { clientX: number }): number {
    const rect = canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  }

  function pointerY(e: { clientY: number }): number {
    const rect = canvas.getBoundingClientRect();
    return e.clientY - rect.top;
  }

  function minWindow(): number {
    const s = source();
    return Math.max(1e-3, s ? 4 / s.sampleRate : 1e-3);
  }

  function onPointerDown(e: PointerEvent) {
    if (!active() || !source()) return;
    stopFollowing();
    const x = pointerX(e);
    const y = pointerY(e);
    const ws = t2x(windowStart());
    const we = t2x(windowEnd());

    let kind: DragKind = "pan";
    // Edge handles win at their x positions; the top bar covers the interior.
    if (Math.abs(x - ws) <= HANDLE_HIT) kind = "start";
    else if (Math.abs(x - we) <= HANDLE_HIT) kind = "end";
    else if (x > ws && x < we && y >= RULER_H && y <= RULER_H + MOVE_HIT) kind = "move";

    drag = {
      kind,
      pointerX: x,
      origViewStart: viewStart(),
      origViewEnd: viewEnd(),
      origWindowStart: windowStart(),
      origWindowEnd: windowEnd(),
    };
    canvas.setPointerCapture(e.pointerId);

    if (kind === "start" || kind === "end") {
      lastPreview = 0;
      previewEdge(kind);
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const x = pointerX(e);

    if (drag.kind === "pan") {
      const dt = ((drag.pointerX - x) / plotW()) * span();
      applyView(drag.origViewStart + dt, drag.origViewEnd + dt);
      return;
    }

    const s = source();
    if (!s) return;

    if (drag.kind === "move") {
      // Slide the whole window by the pointer delta, preserving its width and
      // keeping it inside [0, duration]. The viewport is left untouched.
      const dur = duration();
      const wLen = drag.origWindowEnd - drag.origWindowStart;
      const dt = x2t(x) - x2t(drag.pointerX);
      const start = Math.max(0, Math.min(dur - wLen, drag.origWindowStart + dt));
      setWindowStart(start);
      setWindowEnd(start + wLen);
      return;
    }

    const t = Math.max(0, Math.min(duration(), x2t(x)));
    const gap = minWindow();
    if (drag.kind === "start") {
      setWindowStart(Math.max(0, Math.min(t, windowEnd() - gap)));
    } else {
      setWindowEnd(Math.min(duration(), Math.max(t, windowStart() + gap)));
    }

    // Audition near the handle as it moves (throttled to avoid restart thrash).
    const now = performance.now();
    if (now - lastPreview > PREVIEW_THROTTLE) {
      lastPreview = now;
      previewEdge(drag.kind);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    // Only the edge handles preview + auto-zoom on release; move/pan do not.
    const wasEdge = drag.kind === "start" || drag.kind === "end";
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (wasEdge) {
      endPreview();
      maybeAutoZoom();
    }
  }

  function maybeAutoZoom() {
    const s = source();
    if (!s || s.duration <= 0) return;
    const wDur = windowEnd() - windowStart();
    if (wDur > 0 && wDur <= s.duration * 0.05) {
      const pad = Math.max(wDur * 0.1, s.duration * 0.005);
      applyView(Math.max(0, windowStart() - pad), Math.min(s.duration, windowEnd() + pad));
    }
  }

  function onWheel(e: WheelEvent) {
    if (!source()) return;
    stopFollowing();
    e.preventDefault();
    const t = x2t(pointerX(e));
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    applyView(t + (viewStart() - t) * factor, t + (viewEnd() - t) * factor);
  }

  function zoomBy(factor: number) {
    stopFollowing();
    const center = (viewStart() + viewEnd()) / 2;
    applyView(center + (viewStart() - center) * factor, center + (viewEnd() - center) * factor);
  }

  function zoomToWindow() {
    stopFollowing();
    const wDur = windowEnd() - windowStart();
    const pad = Math.max(wDur * 0.05, 1e-3);
    applyView(Math.max(0, windowStart() - pad), Math.min(duration(), windowEnd() + pad));
  }

  function fitAll() {
    stopFollowing();
    applyView(0, duration());
  }

  // --- lifecycle ---------------------------------------------------------

  /** Fit the bitmap to the region and repaint (also guards against blanking). */
  function syncCanvasSize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    setCssW(rect.width);
    setCssH(rect.height);
    draw();
  }

  onMount(() => {
    const ro = new ResizeObserver(() => syncCanvasSize());
    ro.observe(wrap);
    syncCanvasSize();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => {
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    });
  });

  onCleanup(() => endPreview());

  createEffect(() => {
    // Track everything the canvas draws.
    source();
    status();
    cssW();
    cssH();
    viewStart();
    viewEnd();
    windowStart();
    windowEnd();
    playSec();
    filteredSamples();
    filterEnabled();
    draw();
  });

  const windowDuration = () => windowEnd() - windowStart();

  return (
    <section class="app-timeline">
      <div class="timeline-toolbar">
        <div class="timeline-readout">
          <span>
            <strong>{formatTime(windowStart())}</strong> –{" "}
            <strong>{formatTime(windowEnd())}</strong>
          </span>
          <span class="timeline-dim">Δ {formatTime(windowDuration())}</span>
        </div>
        <span
          class="timeline-filter"
          title={
            filterEnabled()
              ? "The filter graph is applied to the signal"
              : "The filter graph is bypassed"
          }
          style={{
            "font-size": "11px",
            "padding": "1px 6px",
            "border-radius": "4px",
            "white-space": "nowrap",
            color: filterEnabled() ? "#ffb454" : "#8a8a8a",
            border: `1px solid ${filterEnabled() ? "#6b4a1f" : "#3a3a3a"}`,
            background: filterEnabled() ? "rgba(255, 180, 84, 0.12)" : "transparent",
          }}
        >
          {filterEnabled() ? "Filter on" : "Filter off"}
        </span>
        <Show when={(source()?.channels ?? 1) > 1}>
          <ChannelSelect />
        </Show>
        <div class="timeline-actions">
          <Button
            class="timeline-btn"
            disabled={status() !== "ready"}
            title="Preview the analysis window"
            onClick={togglePreview}
          >
            {previewing() ? "■ Stop" : "▶ Preview"}
          </Button>
          <Button
            class="timeline-btn"
            disabled={!active()}
            title="Zoom to the analysis window"
            onClick={zoomToWindow}
          >
            Window
          </Button>
          <Button
            class="timeline-btn"
            disabled={!active()}
            title="Zoom out"
            onClick={() => zoomBy(1.5)}
          >
            −
          </Button>
          <Button
            class="timeline-btn"
            disabled={!active()}
            title="Zoom in"
            onClick={() => zoomBy(1 / 1.5)}
          >
            +
          </Button>
          <Button
            class="timeline-btn"
            disabled={!active()}
            title="Fit the whole source"
            onClick={fitAll}
          >
            Fit
          </Button>
        </div>
      </div>

      <div class="timeline-canvas" ref={wrap}>
        <canvas
          ref={canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <Show when={!active()}>
          <div class="timeline-overlay">
            <Show when={status() === "empty"}>Open a file or record a source to begin</Show>
            <Show when={status() === "probing"}>Reading metadata…</Show>
            <Show when={status() === "decoding"}>Decoding audio…</Show>
            <Show when={status() === "error"}>
              <span class="timeline-error">Source failed — see the Source panel</span>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
