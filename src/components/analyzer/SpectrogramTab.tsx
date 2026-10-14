import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ToolParamsForm from "./ToolParamsForm";
import Readout from "./Readout";
import SelectField from "../SelectField";
import ZoomControls from "./ZoomControls";
import ReframeMenu, { type ReframeTarget } from "./ReframeMenu";
import { createAnalysis, formatHz, toolOptions, type SpectrogramResult } from "../../state/analyzer";
import { analyzerBus } from "../../state/chartSync";
import { chartTheme, resolvedTheme } from "../../state/themes";
import { clamp01, spectroColormap } from "./colormap";
import { formatTimeTick } from "./axisFormat";
import { NoAudioState, timeRangeLabel } from "./chartCommon";

/** Stable sync id for this canvas chart (there are no duplicate tabs). */
const SPECTROGRAM_ID = "spectrogram";

/** Displayed dynamic range below the peak, in dB. */
const DB_RANGES = [40, 60, 80, 100, 120].map((value) => ({
  value,
  label: `${value} dB`,
}));

const MARGIN = { left: 66, right: 8, top: 8, bottom: 22 };

/** The visible window: time (s) and frequency (Hz) bounds. */
interface View {
  t0: number;
  t1: number;
  f0: number;
  f1: number;
}

interface Hover {
  time: number;
  freq: number;
  db: number;
  x: number;
  y: number;
}

/** The full view for a result. */
function fullView(result: SpectrogramResult): View {
  const f0 = result.freqs[0] ?? 0;
  const f1 = result.freqs.length
    ? result.freqs[result.freqs.length - 1]
    : result.sampleRate / 2;
  return { t0: 0, t1: Math.max(result.duration, 1e-6), f0, f1: Math.max(f1, f0 + 1) };
}

/** Keep a proposed view inside the data extent and above a minimum span. */
function clampView(next: View, result: SpectrogramResult): View {
  const duration = Math.max(result.duration, 1e-9);
  const minT = duration * 1e-4;
  let t0 = Math.max(0, Math.min(next.t0, duration));
  let t1 = Math.max(0, Math.min(next.t1, duration));
  if (t1 - t0 < minT) t1 = t0 + minT;
  if (t1 > duration) {
    t1 = duration;
    t0 = Math.max(0, t1 - minT);
  }

  const fLo = result.freqs[0] ?? 0;
  const fHiRaw = result.freqs.length ? result.freqs[result.freqs.length - 1] : result.sampleRate / 2;
  const fHi = Math.max(fHiRaw, fLo + 1);
  const minF = Math.max((fHi - fLo) * 1e-4, 1e-3);
  let f0 = Math.max(fLo, Math.min(next.f0, fHi));
  let f1 = Math.max(fLo, Math.min(next.f1, fHi));
  if (f1 - f0 < minF) f1 = f0 + minF;
  if (f1 > fHi) {
    f1 = fHi;
    f0 = Math.max(fLo, f1 - minF);
  }
  return { t0, t1, f0, f1 };
}

/**
 * Spectrogram tool: a magnitude heatmap of the conditioned signal — time on the
 * horizontal axis, frequency on the vertical, colour for level (dBFS). Rendered on
 * a plain 2D canvas (the Timeline precedent, ADR-7); wheel zooms (Shift for
 * frequency), drag pans, and the overlay controls zoom/fit. See
 * `docs/analysis-tools.md`.
 */
export default function SpectrogramTab() {
  const analysis = createAnalysis<SpectrogramResult>("spectrogram");
  const [dbRange, setDbRange] = createSignal(80);

  /** Per-tool contour overlays (default on). */
  const showCentroid = () => (toolOptions.spectrogram?.showCentroid ?? 1) !== 0;
  const showRolloff = () => (toolOptions.spectrogram?.showRolloff ?? 1) !== 0;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [hover, setHover] = createSignal<Hover | null>(null);
  const [view, setView] = createSignal<View | null>(null);
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);

  let wrap!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let pan: { x: number; y: number; view: View } | null = null;

  // Keep the current zoom across a data refresh (a new analysis result must not
  // reset it); only fit the full window when there is no view yet.
  createEffect(
    on(
      () => analysis.result(),
      (result) => {
        if (!result) {
          setView(null);
          return;
        }
        const current = untrack(view);
        setView(current ? clampView(current, result) : fullView(result));
      },
    ),
  );

  // Follow the shared time range when another analyzer (uPlot or heatmap) zooms it,
  // and reset to the full window when the shared view is cleared (the source changed).
  // `view` is read untracked so writing it here cannot re-trigger this effect.
  createEffect(() => {
    const shared = analyzerBus.data.view;
    const result = analysis.result();
    if (!result) return;
    if (shared == null) {
      setView(fullView(result));
      return;
    }
    if (shared.group !== "time" || shared.sourceId === SPECTROGRAM_ID) return;
    const current = untrack(view);
    if (!current) return;
    setView(clampView({ ...current, t0: shared.x[0], t1: shared.x[1] }, result));
  });

  /** Apply a view locally and (optionally) publish its time range for sync. */
  function applyView(next: View, publishTime: boolean) {
    const result = analysis.result();
    if (!result) return;
    const clamped = clampView(next, result);
    setView(clamped);
    if (publishTime) {
      analyzerBus.setData("view", {
        sourceId: SPECTROGRAM_ID,
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

  /** Offscreen frames×bins image (time × frequency), rebuilt on data/range change. */
  const image = createMemo<HTMLCanvasElement | null>(() => {
    const result = analysis.result();
    if (!result || result.bins === 0 || result.frames === 0) return null;
    const { bins, frames, magDb } = result;
    const floor = result.maxDb - dbRange();
    const span = Math.max(1e-3, result.maxDb - floor);

    const off = document.createElement("canvas");
    // Time runs horizontally, frequency vertically (a spectrogram's convention).
    off.width = frames;
    off.height = bins;
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    const pixels = ctx.createImageData(frames, bins);
    for (let y = 0; y < bins; y++) {
      // Top row = highest frequency.
      const bin = bins - 1 - y;
      for (let x = 0; x < frames; x++) {
        const value = magDb[x * bins + bin];
        const [r, g, bl] = spectroColormap(clamp01((value - floor) / span));
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

  /**
   * Per-frame spectral centroid (centre of mass) and rolloff (85% of the energy
   * below it), in Hz. Derived from the displayed magnitudes so the contours align
   * with the heatmap's frames; `NaN` marks an empty (all-silent) frame.
   */
  const overlays = createMemo(() => {
    const result = analysis.result();
    if (!result || result.frames === 0 || result.bins === 0) return null;
    const { frames, bins, freqs, magDb } = result;
    const centroid = new Float64Array(frames);
    const rolloff = new Float64Array(frames);
    const power = new Float64Array(bins);
    for (let f = 0; f < frames; f++) {
      const base = f * bins;
      let total = 0;
      for (let b = 0; b < bins; b++) {
        const p = Math.pow(10, magDb[base + b] / 10);
        power[b] = p;
        total += p;
      }
      if (!(total > 0)) {
        centroid[f] = NaN;
        rolloff[f] = NaN;
        continue;
      }
      let weighted = 0;
      for (let b = 0; b < bins; b++) weighted += freqs[b] * power[b];
      centroid[f] = weighted / total;
      const target = 0.85 * total;
      let acc = 0;
      let b = 0;
      for (; b < bins; b++) {
        acc += power[b];
        if (acc >= target) break;
      }
      rolloff[f] = freqs[Math.min(b, bins - 1)];
    }
    return { centroid, rolloff };
  });

  /** Bin index whose centre frequency is closest to `freq`. */
  function binAt(result: SpectrogramResult, freq: number): number {
    const freqs = result.freqs;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < freqs.length; i++) {
      const distance = Math.abs(freqs[i] - freq);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  function draw() {
    const ctx = canvas?.getContext("2d");
    const { width, height } = size();
    if (!ctx || width <= 0 || height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = chartTheme().spectroBackground;
    ctx.fillRect(0, 0, width, height);

    const result = analysis.result();
    const v = view();
    const off = image();
    const box = plot();
    if (!result || !off || !v) return;

    // Draw the visible sub-rectangle of the source image (time ×, freq ↑).
    const duration = Math.max(result.duration, 1e-9);
    const sx = clamp01(v.t0 / duration) * result.frames;
    const sw = Math.max(1e-6, (v.t1 - v.t0) / duration) * result.frames;
    let binLo = 0;
    let binHi = result.bins - 1;
    while (binLo < result.bins && (result.freqs[binLo] ?? 0) < v.f0) binLo++;
    while (binHi > 0 && (result.freqs[binHi] ?? 0) > v.f1) binHi--;
    binLo = Math.min(binLo, result.bins - 1);
    binHi = Math.max(binHi, binLo);
    // Image row 0 = highest bin, so the source y is inverted.
    const sy = result.bins - 1 - binHi;
    const sh = binHi - binLo + 1;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, sx, sy, sw, sh, box.x, box.y, box.width, box.height);
    ctx.imageSmoothingEnabled = true;

    drawOverlays(ctx, v, box);
    drawAxes(ctx, v, box);
    drawHover(ctx, box);
    drawMirror(ctx, v, box);
  }

  /** Draw the spectral centroid / rolloff contours over the heatmap. */
  function drawOverlays(
    ctx: CanvasRenderingContext2D,
    v: View,
    box: { x: number; y: number; width: number; height: number },
  ) {
    const result = analysis.result();
    const o = overlays();
    if (!result || !o) return;
    const duration = Math.max(result.duration, 1e-9);
    const freqSpan = Math.max(v.f1 - v.f0, 1e-9);
    const timeSpan = Math.max(v.t1 - v.t0, 1e-9);

    const track = (values: Float64Array, color: string) => {
      const count = values.length;
      if (count < 2) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width, box.height);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      for (let f = 0; f < count; f++) {
        const freq = values[f];
        if (!Number.isFinite(freq)) {
          started = false;
          continue;
        }
        const time = ((f + 0.5) / count) * duration;
        const x = box.x + ((time - v.t0) / timeSpan) * box.width;
        const y = box.y + box.height - ((freq - v.f0) / freqSpan) * box.height;
        if (started) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          started = true;
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    if (showCentroid()) track(o.centroid, chartTheme().overlayCentroid);
    if (showRolloff()) track(o.rolloff, chartTheme().overlayRolloff);
  }

  function drawAxes(
    ctx: CanvasRenderingContext2D,
    v: View,
    box: { x: number; y: number; width: number; height: number },
  ) {
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = chartTheme().axis;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const freq = v.f0 + frac * (v.f1 - v.f0);
      const y = box.y + box.height - frac * box.height;
      ctx.fillText(formatHz(freq), box.x - 6, y);
    }

    const span = v.t1 - v.t0;
    ctx.textBaseline = "top";
    // Keep the edge labels inside the canvas: left/right align the end stops.
    for (const [frac, align] of [
      [0, "left"],
      [0.5, "center"],
      [1, "right"],
    ] as const) {
      const time = v.t0 + frac * span;
      ctx.textAlign = align;
      ctx.fillText(
        `${formatTimeTick(time, span)}s`,
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
    ctx.strokeStyle = chartTheme().hover;
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
    if (!msg || msg.group !== "time" || msg.sourceId === SPECTROGRAM_ID || msg.x == null) return;
    const span = v.t1 - v.t0;
    if (!(span > 0)) return;
    const x = box.x + ((msg.x - v.t0) / span) * box.width;
    if (x < box.x || x > box.x + box.width) return;
    ctx.save();
    ctx.strokeStyle = chartTheme().mirror;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, box.y);
    ctx.lineTo(Math.round(x) + 0.5, box.y + box.height);
    ctx.stroke();
    ctx.restore();
  }

  /** Value at the pointer, or `null` outside the plot area / without data. */
  function pick(clientX: number, clientY: number): Hover | null {
    const result = analysis.result();
    const v = view();
    if (!result || !v || result.frames === 0 || result.bins === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const box = plot();
    if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) return null;

    const time = v.t0 + ((x - box.x) / box.width) * (v.t1 - v.t0);
    const freq = v.f0 + ((box.y + box.height - y) / box.height) * (v.f1 - v.f0);
    const frame = Math.min(
      result.frames - 1,
      Math.max(0, Math.round((time / Math.max(result.duration, 1e-9)) * result.frames - 0.5)),
    );
    const bin = binAt(result, freq);
    return {
      time,
      freq: result.freqs[bin] ?? freq,
      db: result.magDb[frame * result.bins + bin],
      x,
      y,
    };
  }

  function updateHover(event: PointerEvent) {
    setHover(pick(event.clientX, event.clientY));
  }

  // --- interaction -------------------------------------------------------

  function onPointerDown(event: PointerEvent) {
    // Pan with the primary button only, so right-click can open the reframe menu.
    if (event.button !== 0) return;
    const v = view();
    if (!v) return;
    pan = { x: event.clientX, y: event.clientY, view: v };
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    const result = analysis.result();
    if (pan && result) {
      const box = plot();
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      const dt = (dx / box.width) * (pan.view.t1 - pan.view.t0);
      const df = (dy / box.height) * (pan.view.f1 - pan.view.f0);
      applyView(
        {
          t0: pan.view.t0 - dt,
          t1: pan.view.t1 - dt,
          f0: pan.view.f0 + df,
          f1: pan.view.f1 + df,
        },
        true,
      );
    }
    updateHover(event);
  }

  function onPointerUp(event: PointerEvent) {
    pan = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    const result = analysis.result();
    const v = view();
    if (!result || !v) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const box = plot();
    const f = event.deltaY < 0 ? 0.8 : 1.25;

    if (event.shiftKey) {
      const at = v.f0 + ((box.y + box.height - (event.clientY - rect.top)) / box.height) * (v.f1 - v.f0);
      applyView({ ...v, f0: at + (v.f0 - at) * f, f1: at + (v.f1 - at) * f }, false);
    } else {
      const at = v.t0 + ((event.clientX - rect.left - box.x) / box.width) * (v.t1 - v.t0);
      applyView({ ...v, t0: at + (v.t0 - at) * f, t1: at + (v.t1 - at) * f }, true);
    }
  }

  function zoomTime(factor: number) {
    const result = analysis.result();
    const v = view();
    if (!result || !v) return;
    const center = (v.t0 + v.t1) / 2;
    const half = ((v.t1 - v.t0) / 2) * factor;
    applyView({ ...v, t0: center - half, t1: center + half }, true);
  }

  /** Right-click: reframe the timeline window from the time under the pointer. */
  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    const result = analysis.result();
    const v = view();
    if (!result || !v) return;
    const rect = canvas.getBoundingClientRect();
    const box = plot();
    const x = event.clientX - rect.left;
    const time = v.t0 + ((x - box.x) / box.width) * (v.t1 - v.t0);
    setMenu({ x: event.clientX, y: event.clientY, time });
  }

  function fit() {
    const result = analysis.result();
    if (result) applyView(fullView(result), true);
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
    // Non-passive so the wheel can zoom instead of scrolling the page.
    canvas.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => {
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    });
  });

  createEffect(() => {
    // Track everything the canvas draws (theme included, so a theme switch redraws).
    resolvedTheme();
    image();
    overlays();
    size();
    hover();
    view();
    draw();
  });

  const zoomLabel = () => timeRangeLabel(view());

  const hasGrid = () => {
    const result = analysis.result();
    return !!result && result.frames > 0 && result.bins > 0;
  };

  return (
    <AnalyzerTab
      id="spectrogram"
      loading={analysis.loading()}
      error={analysis.error()}
      hasResult={analysis.result() != null}
      params={
        <>
          <ToolParamsForm id="spectrogram" />
          <label class="params-field">
            <span class="params-label">Dynamic range</span>
            <SelectField
              options={DB_RANGES}
              value={dbRange()}
              onChange={setDbRange}
              label="Displayed dynamic range"
            />
          </label>
        </>
      }
    >
      <div class="analyzer-chart">
        <div class="analyzer-readouts">
          {/* Every entry is rendered upfront (with a placeholder) so the bar has a
              stable, reserved height instead of changing as the cursor moves. */}
          <Readout
            label="Time"
            value={hover() ? `${hover()!.time.toFixed(3)} s` : "—"}
          />
          <Readout label="Freq" value={hover() ? formatHz(hover()!.freq) : "—"} />
          <Readout label="Level" value={hover() ? `${hover()!.db.toFixed(1)} dB` : "—"} />
          <Readout
            label="Peak"
            value={analysis.result() ? `${analysis.result()!.maxDb.toFixed(1)} dB` : "—"}
          />
          <Readout
            label="FFT"
            value={
              analysis.result()
                ? `${analysis.result()!.fftSize} · hop ${analysis.result()!.hopSize}`
                : "—"
            }
          />
          <Readout
            label="Grid"
            value={
              analysis.result()
                ? `${analysis.result()!.frames} × ${analysis.result()!.bins}`
                : "—"
            }
          />
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
            onContextMenu={onContextMenu}
          />
          <Show
            when={analysis.result()}
            fallback={<NoAudioState overlay />}
          >
            <Show
              when={hasGrid()}
              fallback={
                <div class="analyzer-empty analyzer-empty-overlay">
                  No spectrogram data — widen the analysis window or lower the FFT size.
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
        <ReframeMenu target={menu()} onClose={() => setMenu(null)} />
      </div>
    </AnalyzerTab>
  );
}
