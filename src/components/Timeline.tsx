import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { playhead, previewRegion, stop as stopPreview } from "../audio/preview";
import { columnExtent, computePeaks, type Peaks } from "../lib/waveform";
import { channelFor } from "../state/analysis";
import { stopFollowing } from "../state/capture";
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

const RULER_H = 20;
const HANDLE_HIT = 9;
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

function niceStep(span: number, width: number): number {
  const target = Math.max(1, width / 90);
  for (const step of TICK_STEPS) {
    if (span / step <= target) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

type DragKind = "start" | "end" | "pan";

/**
 * Timeline (fixed region): waveform of the whole source plus the draggable
 * analysis window.
 *
 * - Wheel zooms around the cursor, drag on the waveform pans, buttons fit /
 *   zoom-to-window.
 * - Dragging a `start`/`end` handle previews an excerpt at that edge; short
 *   windows auto-zoom on release (see `docs/source-model.md`).
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

    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1f1f1f";
    ctx.fillRect(0, waveTop, w, waveH);

    const s = source();
    const ws = t2x(windowStart());
    const we = t2x(windowEnd());

    // Analysis window shading.
    if (s) {
      ctx.fillStyle = "rgba(88, 152, 255, 0.16)";
      ctx.fillRect(ws, waveTop, we - ws, waveH);
    }

    // Waveform.
    if (s && s.frames > 0) {
      const mid = waveTop + waveH / 2;
      const half = (waveH / 2) * 0.94;
      const p = peaks();
      const x0 = PLOT_PAD;
      const x1 = w - PLOT_PAD;
      ctx.strokeStyle = "#6ea8ff";
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

      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.beginPath();
      ctx.moveTo(x0, mid + 0.5);
      ctx.lineTo(x1, mid + 0.5);
      ctx.stroke();
    }

    drawRuler(ctx, w);

    if (s) {
      drawHandle(ctx, ws, waveTop, waveH, "#5898ff");
      drawHandle(ctx, we, waveTop, waveH, "#5898ff");
    }

    const ph = playSec();
    if (ph != null) {
      const x = t2x(ph);
      ctx.strokeStyle = "#ffd166";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, waveTop);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
  }

  function drawRuler(ctx: CanvasRenderingContext2D, w: number) {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.strokeStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(w, RULER_H - 0.5);
    ctx.stroke();

    const step = niceStep(span(), plotW());
    const first = Math.ceil(viewStart() / step) * step;
    ctx.fillStyle = "#8f8f8f";
    ctx.font = "10px Inter, sans-serif";
    ctx.textBaseline = "middle";
    for (let t = first; t <= viewEnd() + 1e-9; t += step) {
      const x = t2x(t);
      ctx.strokeStyle = "#333";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_H - 6);
      ctx.lineTo(x + 0.5, RULER_H);
      ctx.stroke();
      ctx.fillText(formatTime(t), x + 4, RULER_H / 2);
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

  // --- interaction -------------------------------------------------------

  let drag: {
    kind: DragKind;
    pointerX: number;
    origViewStart: number;
    origViewEnd: number;
  } | null = null;
  let lastPreview = 0;

  function pointerX(e: { clientX: number }): number {
    const rect = canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  }

  function minWindow(): number {
    const s = source();
    return Math.max(1e-3, s ? 4 / s.sampleRate : 1e-3);
  }

  function onPointerDown(e: PointerEvent) {
    if (!active() || !source()) return;
    stopFollowing();
    const x = pointerX(e);
    const ws = t2x(windowStart());
    const we = t2x(windowEnd());

    let kind: DragKind = "pan";
    if (Math.abs(x - ws) <= HANDLE_HIT) kind = "start";
    else if (Math.abs(x - we) <= HANDLE_HIT) kind = "end";

    drag = { kind, pointerX: x, origViewStart: viewStart(), origViewEnd: viewEnd() };
    canvas.setPointerCapture(e.pointerId);

    if (kind !== "pan") {
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
    const wasHandle = drag.kind !== "pan";
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (wasHandle) {
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
