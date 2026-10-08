import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import Readout from "./Readout";
import ZoomControls from "./ZoomControls";
import { clamp01, spectroColormap } from "./colormap";
import { analyzerBus } from "../../state/chartSync";
import {
  analyzerById,
  formatHz,
  type AnalysisHandle,
  type AnalyzerId,
  type AnyAnalysisResult,
  type MatrixResult,
  type MatrixView as MatrixViewConfig,
} from "../../state/analyzer";

const MARGIN = { left: 60, right: 8, top: 8, bottom: 18 };

/** The visible time range (seconds). */
interface View {
  t0: number;
  t1: number;
}

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
  const duration = Math.max(result.duration, 1e-9);
  const minT = duration * 1e-4;
  let t0 = Math.max(0, Math.min(next.t0, duration));
  let t1 = Math.max(0, Math.min(next.t1, duration));
  if (t1 - t0 < minT) t1 = t0 + minT;
  if (t1 > duration) {
    t1 = duration;
    t0 = Math.max(0, t1 - minT);
  }
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
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [hover, setHover] = createSignal<Hover | null>(null);
  const [view, setView] = createSignal<View | null>(null);

  let wrap!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let pan: { x: number; view: View } | null = null;

  createEffect(
    on(
      () => result(),
      (value) => setView(value ? fullView(value) : null),
    ),
  );

  // Follow the shared time range when another chart (uPlot or matrix) zooms it.
  createEffect(() => {
    const shared = analyzerBus.data.view;
    const current = result();
    if (!shared || shared.group !== "time" || shared.sourceId === props.id || !current) return;
    setView(clampView({ t0: shared.x[0], t1: shared.x[1] }, current));
  });

  /** Apply a view locally and (optionally) publish it to the shared time group. */
  function applyView(next: View, publish: boolean) {
    const current = result();
    if (!current) return;
    const clamped = clampView(next, current);
    setView(clamped);
    if (publish) {
      analyzerBus.setData("view", {
        sourceId: props.id,
        group: "time",
        x: [clamped.t0, clamped.t1],
      });
    }
  }

  const plot = () => {
    const { width, height } = size();
    return {
      x: MARGIN.left,
      y: MARGIN.top,
      width: Math.max(1, width - MARGIN.left - MARGIN.right),
      height: Math.max(1, height - MARGIN.top - MARGIN.bottom),
    };
  };

  /** Offscreen frames×bins image (time ×, band ↑), rebuilt on data change. */
  const image = createMemo<HTMLCanvasElement | null>(() => {
    const value = result();
    if (!value || value.bins === 0 || value.frames === 0) return null;
    const { bins, frames } = value;
    const lo = value.minValue;
    const hi = Math.max(value.maxValue, lo + 1e-3);
    const span = hi - lo;

    const off = document.createElement("canvas");
    // Time runs horizontally, band vertically.
    off.width = frames;
    off.height = bins;
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    const pixels = ctx.createImageData(frames, bins);
    for (let y = 0; y < bins; y++) {
      // Top row = highest band.
      const band = bins - 1 - y;
      for (let x = 0; x < frames; x++) {
        const cell = value.values[x * bins + band];
        const [r, g, bl] = spectroColormap(clamp01((cell - lo) / span));
        const offset = (y * frames + x) * 4;
        pixels.data[offset] = r;
        pixels.data[offset + 1] = g;
        pixels.data[offset + 2] = bl;
        pixels.data[offset + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return off;
  });

  function draw() {
    const ctx = canvas?.getContext("2d");
    const { width, height } = size();
    if (!ctx || width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1f1f1f";
    ctx.fillRect(0, 0, width, height);

    const value = result();
    const v = view();
    const off = image();
    const box = plot();
    if (!value || !off || !v) return;

    const duration = Math.max(value.duration, 1e-9);
    const sx = clamp01(v.t0 / duration) * value.frames;
    const sw = Math.max(1e-6, (v.t1 - v.t0) / duration) * value.frames;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, sx, 0, sw, value.bins, box.x, box.y, box.width, box.height);
    ctx.imageSmoothingEnabled = true;

    drawBands(ctx, value, box);
    drawTime(ctx, v, box);
    drawHover(ctx, box);
    drawMirror(ctx, v, box);
  }

  function drawBands(
    ctx: CanvasRenderingContext2D,
    value: MatrixResult,
    box: { x: number; y: number; width: number; height: number },
  ) {
    if (value.bins === 0) return;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = "#8f8f8f";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const band = Math.round(frac * (value.bins - 1));
      const y = box.y + box.height - frac * box.height;
      ctx.fillText(config().formatBand(band), box.x - 6, y);
    }
    ctx.textAlign = "left";
  }

  function drawTime(
    ctx: CanvasRenderingContext2D,
    v: View,
    box: { x: number; y: number; width: number; height: number },
  ) {
    const span = v.t1 - v.t0;
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = "#8f8f8f";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const frac of [0, 0.5, 1]) {
      const time = v.t0 + frac * span;
      ctx.fillText(
        `${time.toFixed(span < 2 ? 3 : 2)}s`,
        box.x + frac * box.width,
        box.y + box.height + 4,
      );
    }
    ctx.textAlign = "left";
  }

  function drawHover(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; width: number; height: number },
  ) {
    const h = hover();
    if (!h) return;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, h.y + 0.5);
    ctx.lineTo(box.x + box.width, h.y + 0.5);
    ctx.moveTo(h.x + 0.5, box.y);
    ctx.lineTo(h.x + 0.5, box.y + box.height);
    ctx.stroke();
  }

  /** Draw the shared cursor from whichever other time chart is hovered. */
  function drawMirror(
    ctx: CanvasRenderingContext2D,
    v: View,
    box: { x: number; y: number; width: number; height: number },
  ) {
    const msg = analyzerBus.data.cursorSync;
    if (!msg || msg.group !== "time" || msg.sourceId === props.id || msg.x == null) return;
    const span = v.t1 - v.t0;
    if (!(span > 0)) return;
    const x = box.x + ((msg.x - v.t0) / span) * box.width;
    if (x < box.x || x > box.x + box.width) return;
    ctx.save();
    ctx.strokeStyle = "rgba(120, 170, 255, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, box.y);
    ctx.lineTo(Math.round(x) + 0.5, box.y + box.height);
    ctx.stroke();
    ctx.restore();
  }

  function pick(clientX: number, clientY: number): Hover | null {
    const value = result();
    const v = view();
    if (!value || !v || value.frames === 0 || value.bins === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const box = plot();
    if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) return null;

    const time = v.t0 + ((x - box.x) / box.width) * (v.t1 - v.t0);
    const band = Math.min(
      value.bins - 1,
      Math.max(0, Math.round((1 - (y - box.y) / box.height) * (value.bins - 1))),
    );
    const frame = Math.min(
      value.frames - 1,
      Math.max(0, Math.round((time / Math.max(value.duration, 1e-9)) * value.frames - 0.5)),
    );
    return {
      time,
      band,
      value: value.values[frame * value.bins + band],
      x,
      y,
    };
  }

  // --- interaction -------------------------------------------------------

  function onPointerDown(event: PointerEvent) {
    const v = view();
    if (!v) return;
    pan = { x: event.clientX, view: v };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (pan) {
      const box = plot();
      const dx = event.clientX - pan.x;
      const dt = (dx / box.width) * (pan.view.t1 - pan.view.t0);
      applyView({ t0: pan.view.t0 - dt, t1: pan.view.t1 - dt }, true);
    }
    setHover(pick(event.clientX, event.clientY));
  }

  function onPointerUp(event: PointerEvent) {
    pan = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    const v = view();
    if (!v) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const box = plot();
    const f = event.deltaY < 0 ? 0.8 : 1.25;
    const at = v.t0 + ((event.clientX - rect.left - box.x) / box.width) * (v.t1 - v.t0);
    applyView({ t0: at + (v.t0 - at) * f, t1: at + (v.t1 - at) * f }, true);
  }

  function zoomTime(factor: number) {
    const v = view();
    if (!v) return;
    const center = (v.t0 + v.t1) / 2;
    const half = ((v.t1 - v.t0) / 2) * factor;
    applyView({ t0: center - half, t1: center + half }, true);
  }

  function fit() {
    const value = result();
    if (value) applyView(fullView(value), true);
  }

  // --- lifecycle ---------------------------------------------------------

  function syncSize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    setSize({ width: rect.width, height: rect.height });
  }

  onMount(() => {
    const observer = new ResizeObserver(() => syncSize());
    observer.observe(wrap);
    syncSize();
    canvas.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => {
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    });
  });

  createEffect(() => {
    // Track everything the canvas draws.
    image();
    size();
    hover();
    view();
    draw();
  });

  const zoomLabel = () => {
    const v = view();
    return v ? `${v.t0.toFixed(3)} – ${v.t1.toFixed(3)} s` : "";
  };

  const hasGrid = () => {
    const r = result();
    return !!r && r.frames > 0 && r.bins > 0;
  };

  return (
    <div class="analyzer-chart">
      <div class="analyzer-readouts">
        <Show when={hover()} fallback={<Readout label="Hover" value="—" />}>
          {(h) => (
            <>
              <Readout label="Time" value={`${h().time.toFixed(3)} s`} />
              <Readout label={config().yLabel} value={config().formatBand(h().band)} />
              <Readout label="Value" value={config().formatValue(h().value)} />
            </>
          )}
        </Show>
        <Show when={result()}>
          {(r) => (
            <>
              <Readout label="Grid" value={`${r().frames} × ${r().bins}`} />
              <Readout
                label="Range"
                value={`${config().formatValue(r().minValue)} … ${config().formatValue(r().maxValue)}`}
              />
              <Readout label="Rate" value={formatHz(r().sampleRate)} />
            </>
          )}
        </Show>
      </div>
      <div class="spectrogram-canvas" ref={wrap}>
        <canvas
          ref={canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            if (!pan) setHover(null);
          }}
        />
        <Show
          when={result()}
          fallback={
            <div class="analyzer-empty analyzer-empty-overlay">
              Open a source and set the analysis window.
            </div>
          }
        >
          <Show
            when={hasGrid()}
            fallback={
              <div class="analyzer-empty analyzer-empty-overlay">
                No values in this window — widen the analysis window or lower the FFT size.
              </div>
            }
          >
            <ZoomControls
              onZoomIn={() => zoomTime(0.5)}
              onZoomOut={() => zoomTime(2)}
              onFit={fit}
              label={zoomLabel()}
            />
          </Show>
        </Show>
      </div>
    </div>
  );
}
