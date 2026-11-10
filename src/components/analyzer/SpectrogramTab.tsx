import { createEffect, createSignal, Show } from "solid-js";
import AnalyzerTab from "./AnalyzerTab";
import ToolParamsForm from "./ToolParamsForm";
import Readout from "./Readout";
import SelectField from "../SelectField";
import ReframeMenu from "./ReframeMenu";
import ChartLegend, { type ChartLegendEntry } from "./chartLegend";
import HeatmapColorScale from "./HeatmapColorScale";
import PitchOverlaySource from "./PitchOverlaySource";
import {
  analyzerById,
  createAnalysis,
  formatHz,
  toolOptions,
  type SpectrogramResult,
} from "../../state/analyzer";
import { activeThemeId, chartTheme } from "../../state/themes";
import { contourAt } from "../../lib/equalLoudness";
import { useCanvasImage } from "./chartImage";
import { NoAudioState, ZoomChrome, createZoomReveal, type ChartZoom } from "./chartCommon";
import { createSpectrogramCanvas } from "./spectrogramCanvas";
import { SPECTROGRAM_DB_RANGE } from "./spectrogramView";
import type { PitchOverlay } from "./spectrogramRender";
import { frequencyScaleLabel, frequencyScaleOf } from "./frequencyScale";
import { hasFrameData } from "./chartGeometry";

/** Stable sync id for this canvas chart (there are no duplicate tabs). */
const SPECTROGRAM_ID = "spectrogram";

/** Displayed dynamic range below the peak, in dB. */
const DB_RANGES = [40, 60, 80, 100, 120].map((value) => ({
  value,
  label: `${value} dB`,
}));

/**
 * Spectrogram tool: a magnitude heatmap of the conditioned signal — time on the
 * horizontal axis, frequency on the vertical, colour for level (dBFS). Rendered on
 * a plain 2D canvas (the Timeline precedent, ADR-7); wheel zooms (Shift for
 * frequency), drag pans, and the overlay controls zoom/fit. See
 * `docs/analysis-tools.md`.
 *
 * The vertical axis follows the tool's **frequency scale** (M36): the FFT rows are
 * resampled into the display coordinate, and the axis labels, pointer picking and
 * zoom all use the same mapping, so a Bark / ERB view is truthful rather than a
 * mislabelled stretch. See `frequencyScale.ts` and `spectrogramView.ts`.
 */
export default function SpectrogramTab() {
  const analysis = createAnalysis<SpectrogramResult>("spectrogram");
  const [dbRange, setDbRange] = createSignal(SPECTROGRAM_DB_RANGE);

  /** The vertical frequency scale (view-only; the engine never sees it). */
  const frequencyScale = () => frequencyScaleOf(toolOptions.spectrogram?.frequencyScale);

  /** Per-tool contour overlays (default on). */
  const toggles = () => ({
    centroid: (toolOptions.spectrogram?.showCentroid ?? 1) !== 0,
    rolloff: (toolOptions.spectrogram?.showRolloff ?? 1) !== 0,
    // The composed pYIN track is opt-in per view option; its analysis only runs while
    // one of these is on (`PitchOverlaySource` is mounted below).
    pitch: (toolOptions.spectrogram?.showPitch ?? 0) !== 0,
    harmonics: (toolOptions.spectrogram?.showHarmonics ?? 0) !== 0,
  });
  /** Selected equal-loudness contour phon level (`0` = off). */
  const phonLevel = () => toolOptions.spectrogram?.phonLevel ?? 0;

  /** The F0 track composed from a separate `pitchPyin` run of the same window (M36). */
  const [pitchOverlay, setPitchOverlay] = createSignal<PitchOverlay | null>(null);
  /**
   * The detector that composes the overlay declares the capability on its own view
   * descriptor (`PitchDisplay.spectrogramOverlay`) — never inferred from an id prefix.
   */
  const overlayCapable = () => {
    const view = analyzerById("pitchPyin").view;
    return view.kind === "series" && (view.pitchDisplay?.spectrogramOverlay ?? false);
  };
  const wantsPitch = () => overlayCapable() && (toggles().pitch || toggles().harmonics);

  const canvas = createSpectrogramCanvas({
    id: SPECTROGRAM_ID,
    result: () => analysis.result(),
    dbRange,
    scale: frequencyScale,
    toggles,
    pitch: pitchOverlay,
  });
  const chart = canvas.chart;

  // Export the rendered heatmap (M12).
  useCanvasImage(SPECTROGRAM_ID, chart.canvas);

  createEffect(() => {
    // Track everything the canvas draws (the active theme, the preview playhead and the
    // axis mode included, so any theme switch, the transport and a scale change all
    // repaint). Keyed on the theme **id**, not just its base: two themes on the same
    // base still recolour the canvas.
    activeThemeId();
    canvas.overlays();
    pitchOverlay();
    frequencyScale();
    chart.size();
    chart.hover();
    chart.view();
    canvas.draw();
  });

  /** The equal-loudness contour's reference level at the cursor frequency, in dB SPL. */
  const referenceAtCursor = () => {
    const hover = chart.hover();
    const phon = phonLevel();
    return hover && phon > 0 ? contourAt(phon, hover.freq) : null;
  };

  const hasGrid = () => hasFrameData(analysis.result());

  /** The zoom chrome only while the chart is in use (M36). */
  const reveal = createZoomReveal(() => !chart.atFit());
  const zoomChrome = (): ChartZoom => ({
    zoomIn: chart.zoomIn,
    zoomOut: chart.zoomOut,
    fit: chart.fit,
    label: chart.zoomLabel(),
  });

  /** The drawn marks, named with the shared compact legend (theme roles). */
  const legend = (): ChartLegendEntry[] => {
    const theme = chartTheme();
    const drawn = toggles();
    const rows: ChartLegendEntry[] = [];
    if (drawn.centroid) rows.push({ label: "centroid", color: theme.overlayCentroid });
    if (drawn.rolloff) rows.push({ label: "rolloff", color: theme.overlayRolloff });
    const overlay = pitchOverlay();
    if (overlay && drawn.pitch) {
      rows.push({ label: "f0 (pYIN)", color: theme.markerBeat, kind: "dashed" });
    }
    if (overlay?.harmonics?.length && drawn.harmonics) {
      rows.push({ label: "harmonics (median f0)", color: theme.markerBeat, kind: "dashed" });
    }
    return rows;
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
        {/* Runs the pitch analysis only while the overlay is switched on. */}
        <Show when={wantsPitch()}>
          <PitchOverlaySource spectrogram={() => analysis.result()} onOverlay={setPitchOverlay} />
        </Show>
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
          <Show when={phonLevel() > 0}>
            <Readout
              label="Contour"
              value={`${phonLevel()} phon`}
              title="Equal-loudness reference level, in dB SPL."
            />
            <Readout
              label="Ref @ cursor"
              value={
                referenceAtCursor() == null ? "—" : `${referenceAtCursor()!.toFixed(1)} dB SPL`
              }
              title="The contour's level at the cursor frequency. The heatmap is dBFS; the two scales are separate."
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
          <Show when={analysis.result()} fallback={<NoAudioState overlay />}>
            <Show
              when={hasGrid()}
              fallback={
                <div class="analyzer-empty analyzer-empty-overlay">
                  No spectrogram data — widen the analysis window or lower the FFT size.
                </div>
              }
            >
              <ZoomChrome zoom={zoomChrome()} revealed={reveal.revealed()} />
            </Show>
          </Show>
        </div>
        {/* The level colourbar spans exactly the heatmap's domain, `maxDb − range … maxDb`. */}
        <Show when={canvas.levelScale()}>
          {(scale) => <HeatmapColorScale scale={scale()} label="level dBFS" />}
        </Show>
        <ChartLegend entries={legend()} note={frequencyScaleLabel(frequencyScale())} />
        <ReframeMenu
          target={chart.menu()}
          onClose={() => chart.setMenu(null)}
          tool={SPECTROGRAM_ID}
        />
      </div>
    </AnalyzerTab>
  );
}
