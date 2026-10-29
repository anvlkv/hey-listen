import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import { Show, onCleanup, untrack } from "solid-js";
import ChartTooltip from "./ChartTooltip";
import Readout from "./Readout";
import ZoomControls from "./ZoomControls";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { FREQ_AXIS_SPACE, X_AXIS_SIZE, Y_AXIS_SIZE, Y_AXIS_SPACE } from "./axisFormat";
import { chartAxisStyle, NoAudioState } from "./chartCommon";
import { analyzerBus, type SyncGroup } from "../../state/chartSync";
import { registerChartImage, unregisterChartImage } from "../../state/exportRegistry";
import { activeThemeId, chartTheme } from "../../state/themes";
import type {
  AnalysisHandle,
  AnalyzerId,
  AnyAnalysisResult,
  ModulationResult,
} from "../../state/analyzer";

/** The modulation spectra are on their own rate axis, so they sync separately. */
const MOD_GROUP: SyncGroup = "mod";

/** The levels below this are the analysis floor (silence), not a real spectrum. */
const SPECTRUM_FLOOR = -119.5;
/** A fixed y-range so AM and FM are directly comparable and silence stays flat. */
const MOD_Y_RANGE: [number, number] = [-60, 5];

/** A modulation rate, short enough for an axis tick. */
function formatRate(hz: number): string {
  const decimals = Math.abs(hz) < 10 ? 1 : 0;
  return `${hz.toFixed(decimals)} Hz`;
}

function rateAxisValues(_self: unknown, ticks: (number | null)[]): string[] {
  return ticks.map((tick) => (tick == null ? "" : formatRate(tick)));
}

const ModTooltip = (props: TooltipProps) => (
  <ChartTooltip
    {...props}
    xLabel="rate"
    formatX={(value) => formatRate(value)}
    formatY={(value) => `${value.toFixed(1)} dB`}
  />
);

/** A legend swatch drawn inline, so the view needs no extra stylesheet rules. */
const Swatch = (props: { color: string }) => (
  <span
    style={{
      display: "inline-block",
      width: "12px",
      height: "2px",
      margin: "0 6px 0 0",
      "vertical-align": "middle",
      background: props.color,
    }}
  />
);

const percent = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(0)}%`);
const readout = (value: number | null, unit: string, decimals = 1) =>
  value == null ? "—" : `${value.toFixed(decimals)} ${unit}`;

/** Keep real bins; the floor means "silence", which should read as a gap. */
function visible(db: number[]): (number | null)[] {
  return db.map((value) => (value > SPECTRUM_FLOOR ? value : null));
}

/**
 * The `modulation` view (M20): the AM and FM spectra on one modulation-rate axis,
 * with ranked-rate / depth readouts above them. It joins its own chart-sync group
 * (`"mod"`), not the audio-frequency one, because its x-axis is a modulation rate.
 *
 * The AM series is the frame-RMS envelope's spectrum; the FM series is the longest
 * voiced run's pitch residual in cents. An absent FM run (no long enough voiced
 * stretch) leaves the FM series empty rather than drawing a misleading flat line.
 */
export default function ModulationView(props: {
  id: AnalyzerId;
  analysis: AnalysisHandle<AnyAnalysisResult>;
}) {
  const result = () => props.analysis.result() as ModulationResult | null;
  const zoom = createUplotZoom(MOD_GROUP);

  // Export the rendered AM/FM spectrum (M12).
  const imageProvider = () => zoom.instance()?.ctx.canvas ?? null;
  registerChartImage(
    untrack(() => props.id),
    imageProvider,
  );
  onCleanup(() =>
    unregisterChartImage(
      untrack(() => props.id),
      imageProvider,
    ),
  );

  const data = (): [number[], (number | null)[], (number | null)[]] => {
    const r = result();
    if (!r || r.modFreqs.length === 0) return [[], [], []];
    // One spectrum may be absent (a steady AM envelope, or no/steady FM run): uPlot
    // needs every column the same length, so an absent one becomes a column of gaps.
    const freqs = r.modFreqs;
    const column = (db: number[]) =>
      db.length === freqs.length ? visible(db) : freqs.map(() => null);
    return [freqs, column(r.amDb), column(r.fmDb)];
  };

  /** A chart needs at least two bins and one real level. */
  const plottable = () => {
    const [freqs, am, fm] = data();
    return freqs.length >= 2 && (am.some((v) => v != null) || fm.some((v) => v != null));
  };

  const rangeLabel = () => {
    const range = zoom.range();
    return range ? `${formatRate(range[0])} – ${formatRate(range[1])}` : "";
  };

  const topAm = () => result()?.amPeaks[0]?.rateHz;
  const topFm = () => result()?.fmRateHz ?? null;

  return (
    <Show when={result()} fallback={<NoAudioState />}>
      {(value) => (
        <div class="analyzer-chart" data-testid="modulation.chart">
          <div class="analyzer-readouts">
            <Readout
              label="AM top rate"
              value={topAm() == null ? "—" : formatRate(topAm()!)}
              title="Strongest amplitude-modulation rate"
            />
            <Readout
              label="AM depth"
              value={percent(value().amDepth)}
              title="(max − min) / (max + min) of the linear amplitude envelope"
            />
            <Readout
              label="AM peak–trough"
              value={readout(value().amPeakToTroughDb, "dB")}
              title="Range of the frame-RMS envelope over the window"
            />
            <Readout
              label="FM top rate"
              value={topFm() == null ? "—" : formatRate(topFm()!)}
              title="Strongest pitch-modulation rate in the longest voiced run"
            />
            <Readout
              label="FM peak–peak"
              value={readout(value().fmPeakToPeakCents, "¢", 0)}
              title="Peak-to-peak depth of the detrended pitch track, in cents"
            />
            <Readout
              label="FM σ"
              value={readout(value().fmStdCents, "¢", 0)}
              title="Standard deviation of the detrended pitch track, in cents"
            />
            <Readout
              label="FM run"
              value={
                value().fmRunStartSecs == null
                  ? "—"
                  : `${value().fmRunStartSecs!.toFixed(2)}–${value().fmRunEndSecs!.toFixed(2)} s`
              }
              title="The voiced run the FM spectrum was measured over (source seconds)"
            />
            <Readout
              label="Voiced"
              value={`${(value().voicedFraction * 100).toFixed(0)}%`}
              title="Share of the window's pitch frames the detector found voiced"
            />
            <Readout
              label="Range"
              value={`${formatRate(value().effectiveModMinHz)} – ${formatRate(
                value().effectiveModMaxHz,
              )}`}
              title="The modulation rates actually analysed after the anti-alias clamp"
            />
          </div>

          <div class="note-segments-legend">
            <span class="note-segments-legend-item">
              <Swatch color={chartTheme().series} /> AM (envelope)
            </span>
            <span class="note-segments-legend-item">
              <Swatch color={chartTheme().seriesMax} /> FM (cents)
            </span>
          </div>

          <div class="analyzer-plot" onWheel={zoom.wheel}>
            <Show
              when={plottable()}
              fallback={
                <div class="analyzer-empty">
                  No modulation above the floor in this window — widen the analysis window, lower{" "}
                  <strong>Min rate</strong>, or choose material with a changing level or pitch.
                </div>
              }
            >
              <ZoomControls
                onZoomIn={zoom.zoomIn}
                onZoomOut={zoom.zoomOut}
                onFit={zoom.fit}
                label={rangeLabel()}
              />
              <Show when={activeThemeId()} keyed>
                <SolidUplot
                  autoResize
                  pluginBus={analyzerBus}
                  plugins={[
                    cursor(),
                    tooltip(ModTooltip),
                    mirrorCursor(MOD_GROUP),
                    syncView(MOD_GROUP),
                  ]}
                  onCreate={zoom.onReady}
                  data={data()}
                  series={[
                    {},
                    {
                      label: "AM",
                      stroke: chartTheme().series,
                      width: 1.5,
                      fill: chartTheme().waveFill,
                    },
                    {
                      label: "FM",
                      stroke: chartTheme().seriesMax,
                      width: 1.5,
                    },
                  ]}
                  scales={{
                    x: { time: false },
                    y: { range: () => MOD_Y_RANGE },
                  }}
                  axes={[
                    {
                      ...chartAxisStyle(),
                      label: "modulation rate (Hz)",
                      size: X_AXIS_SIZE,
                      space: FREQ_AXIS_SPACE,
                      values: rateAxisValues,
                    },
                    {
                      ...chartAxisStyle(),
                      label: "relative level (dB)",
                      size: Y_AXIS_SIZE,
                      space: Y_AXIS_SPACE,
                    },
                  ]}
                />
              </Show>
            </Show>
          </div>

          <Show when={value().fmDb.length === 0}>
            <div class="analyzer-hint">
              <Show
                when={value().fmRunStartSecs == null}
                fallback={
                  <>
                    FM is blank: the analysed voiced run barely changes pitch (under 2 ¢ of spread),
                    so no rate is reported.
                  </>
                }
              >
                FM is blank: no voiced run is long enough to measure. The AM spectrum is still
                shown; lengthen the window or lower <strong>Min voiced run</strong>.
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
