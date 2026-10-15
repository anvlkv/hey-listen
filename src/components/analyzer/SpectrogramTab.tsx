import { createEffect, createMemo, createSignal, Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ToolParamsForm from "./ToolParamsForm";
import Readout from "./Readout";
import SelectField from "../SelectField";
import ZoomControls from "./ZoomControls";
import ReframeMenu from "./ReframeMenu";
import {
  createAnalysis,
  formatHz,
  toolOptions,
  type SpectrogramResult,
} from "../../state/analyzer";
import { resolvedTheme } from "../../state/themes";
import { clamp01 } from "./colormap";
import { NoAudioState } from "./chartCommon";
import { createChartInteraction } from "./chartInteraction";
import {
  beginFrame,
  blitHeatmap,
  drawHoverCross,
  drawMirrorCursor,
  drawNoteOverlay,
  drawTimeAxis,
} from "./chartCanvas";
import {
  binAt,
  drawContours,
  drawFrequencyAxis,
  spectrogramImage,
  spectrogramOverlays,
  type SpectrogramWindow,
} from "./spectrogramRender";
import { clampTimeRange, frameIndex, hasFrameData } from "./chartGeometry";

/** Stable sync id for this canvas chart (there are no duplicate tabs). */
const SPECTROGRAM_ID = "spectrogram";

/** Displayed dynamic range below the peak, in dB. */
const DB_RANGES = [40, 60, 80, 100, 120].map((value) => ({
  value,
  label: `${value} dB`,
}));

/** The visible window: time (s) and frequency (Hz) bounds. */
type View = SpectrogramWindow;

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
  const f1 = result.freqs.length ? result.freqs[result.freqs.length - 1] : result.sampleRate / 2;
  return {
    t0: result.windowStart,
    t1: result.windowStart + Math.max(result.duration, 1e-6),
    f0,
    f1: Math.max(f1, f0 + 1),
  };
}

/** Keep a proposed view inside the data extent and above a minimum span. */
function clampView(next: View, result: SpectrogramResult): View {
  const [t0, t1] = clampTimeRange(next.t0, next.t1, result.windowStart, result.duration);

  const fLo = result.freqs[0] ?? 0;
  const fHiRaw = result.freqs.length
    ? result.freqs[result.freqs.length - 1]
    : result.sampleRate / 2;
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

  const chart = createChartInteraction<View, Hover, SpectrogramResult>({
    id: SPECTROGRAM_ID,
    result: () => analysis.result(),
    fullView,
    clampView,
    // Preserve the frequency window when another chart zooms the shared time range.
    applyShared: (current, x, result) =>
      current ? clampView({ ...current, t0: x[0], t1: x[1] }, result) : null,
    pan: (v, dxFrac, dyFrac) => {
      const dt = dxFrac * (v.t1 - v.t0);
      const df = dyFrac * (v.f1 - v.f0);
      return { t0: v.t0 - dt, t1: v.t1 - dt, f0: v.f0 + df, f1: v.f1 + df };
    },
    wheel: (v, xFrac, yFrac, factor, shift) => {
      if (shift) {
        const at = v.f0 + yFrac * (v.f1 - v.f0);
        return {
          view: { ...v, f0: at + (v.f0 - at) * factor, f1: at + (v.f1 - at) * factor },
          publish: false,
        };
      }
      const at = v.t0 + xFrac * (v.t1 - v.t0);
      return {
        view: { ...v, t0: at + (v.t0 - at) * factor, t1: at + (v.t1 - at) * factor },
        publish: true,
      };
    },
    pick: (geo) => {
      const result = analysis.result();
      if (!result || result.frames === 0 || result.bins === 0) return null;
      const frame = frameIndex(geo.time, result.windowStart, result.duration, result.frames);
      const freq = geo.view.f0 + geo.yFrac * (geo.view.f1 - geo.view.f0);
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

  const image = createMemo(() => spectrogramImage(analysis.result(), dbRange()));
  const overlays = createMemo(() => spectrogramOverlays(analysis.result()));

  function draw() {
    const { width, height } = chart.size();
    const ctx = beginFrame(chart.canvas(), width, height);
    if (!ctx) return;

    const result = analysis.result();
    const v = chart.view();
    const off = image();
    const box = chart.box();
    if (!result || !off || !v) return;

    // Draw the visible sub-rectangle of the source image (time ×, freq ↑).
    const duration = Math.max(result.duration, 1e-9);
    const sx = clamp01((v.t0 - result.windowStart) / duration) * result.frames;
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

    blitHeatmap(ctx, off, sx, sy, sw, sh, box);

    drawContours(ctx, v, box, result.windowStart, result.duration, overlays(), {
      centroid: showCentroid(),
      rolloff: showRolloff(),
    });
    drawFrequencyAxis(ctx, v, box);
    drawTimeAxis(ctx, v, box);
    drawHoverCross(ctx, box, chart.hover());
    drawMirrorCursor(ctx, v, box, SPECTROGRAM_ID);
    drawNoteOverlay(ctx, v, box, SPECTROGRAM_ID);
  }

  createEffect(() => {
    // Track everything the canvas draws (theme included, so a theme switch redraws).
    resolvedTheme();
    image();
    overlays();
    chart.size();
    chart.hover();
    chart.view();
    draw();
  });

  const hasGrid = () => hasFrameData(analysis.result());

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
            value={chart.hover() ? `${chart.hover()!.time.toFixed(3)} s` : "—"}
          />
          <Readout label="Freq" value={chart.hover() ? formatHz(chart.hover()!.freq) : "—"} />
          <Readout
            label="Level"
            value={chart.hover() ? `${chart.hover()!.db.toFixed(1)} dB` : "—"}
          />
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
              analysis.result() ? `${analysis.result()!.frames} × ${analysis.result()!.bins}` : "—"
            }
          />
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
          <Show when={analysis.result()} fallback={<NoAudioState overlay />}>
            <Show
              when={hasGrid()}
              fallback={
                <div class="analyzer-empty analyzer-empty-overlay">
                  No spectrogram data — widen the analysis window or lower the FFT size.
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
        <ReframeMenu
          target={chart.menu()}
          onClose={() => chart.setMenu(null)}
          tool={SPECTROGRAM_ID}
        />
      </div>
    </AnalyzerTab>
  );
}
