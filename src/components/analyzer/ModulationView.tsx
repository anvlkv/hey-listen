import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip } from "@dschz/solid-uplot/plugins";
import { Show } from "solid-js";
import Readout from "./Readout";
import { createUplotZoom } from "./uplotZoom";
import { mirrorCursor, syncView } from "./syncPlugins";
import { FREQ_AXIS_SPACE, X_AXIS_SIZE, Y_AXIS_SIZE, Y_AXIS_SPACE } from "./axisFormat";
import { chartAxisStyle, NoAudioState, UplotChartPlot } from "./chartCommon";
import ChartLegend from "./chartLegend";
import { verticalMarks, verticalRegions, type VerticalMark } from "./verticalMarkers";
import {
  formatRate,
  MOD_LEGEND_NOTE,
  MOD_REFERENCE_REGIONS,
  MOD_Y_RANGE,
  ModulationTooltip,
  rateAxisValues,
  visibleLevels,
} from "./modulationCommon";
import { analyzerBus, type SyncGroup } from "../../state/chartSync";
import { useUplotImage } from "./chartImage";
import { activeThemeId, chartTheme } from "../../state/themes";
import type {
  AnalysisHandle,
  AnalyzerId,
  AnyAnalysisResult,
  ModulationResult,
} from "../../state/analyzer";

/** The modulation spectra are on their own rate axis, so they sync separately. */
const MOD_GROUP: SyncGroup = "mod";

const percent = (value: number | null) => (value == null ? "—" : `${(value * 100).toFixed(0)}%`);
const readout = (value: number | null, unit: string, decimals = 1) =>
  value == null ? "—" : `${value.toFixed(decimals)} ${unit}`;

/**
 * One spectrum side's ranked peaks as rules: the strongest is captioned, the rest stay
 * unlabelled ticks so three peaks a side do not overprint each other.
 */
function peakMarksOf(peaks: { rateHz: number }[], color: string, dash: number[]): VerticalMark[] {
  return peaks.map((peak, index) => ({
    at: peak.rateHz,
    label: index === 0 ? formatRate(peak.rateHz) : undefined,
    color,
    dash,
  }));
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
  useUplotImage(() => props.id, zoom.instance);

  const data = (): [number[], (number | null)[], (number | null)[]] => {
    const r = result();
    if (!r || r.modFreqs.length === 0) return [[], [], []];
    // One spectrum may be absent (a steady AM envelope, or no/steady FM run): uPlot
    // needs every column the same length, so an absent one becomes a column of gaps.
    const freqs = r.modFreqs;
    const column = (db: number[]) =>
      db.length === freqs.length ? visibleLevels(db) : freqs.map(() => null);
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

  /**
   * The ranked peaks, drawn as labelled rules: the strongest rate on each side is
   * captioned, the rest are ticks, so a spectrum with three peaks a side stays legible.
   */
  const peakMarks = (): VerticalMark[] => {
    const r = result();
    if (!r) return [];
    const theme = chartTheme();
    return [
      ...peakMarksOf(r.amPeaks, theme.series, [4, 3]),
      ...peakMarksOf(r.fmPeaks, theme.seriesMax, [2, 3]),
    ];
  };

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

          <ChartLegend
            entries={[
              { label: "AM (amplitude modulation)", color: chartTheme().series },
              { label: "FM (pitch modulation, cents)", color: chartTheme().seriesMax },
              ...(value().amPeaks.length
                ? [{ label: "AM peak rate", color: chartTheme().series, kind: "dashed" as const }]
                : []),
              ...(value().fmPeaks.length
                ? [
                    {
                      label: "FM peak rate",
                      color: chartTheme().seriesMax,
                      kind: "dashed" as const,
                    },
                  ]
                : []),
              { label: "model-sensitive band", color: chartTheme().grid, kind: "fill" as const },
            ]}
            note={MOD_LEGEND_NOTE}
          />

          <UplotChartPlot zoom={zoom} label={rangeLabel()} onWheel={zoom.wheel}>
            <Show
              when={plottable()}
              fallback={
                <div class="analyzer-empty">
                  No modulation above the floor in this window — widen the analysis window, lower{" "}
                  <strong>Min rate</strong>, or choose material with a changing level or pitch.
                </div>
              }
            >
              <Show when={activeThemeId()} keyed>
                <SolidUplot
                  autoResize
                  pluginBus={analyzerBus}
                  plugins={[
                    cursor(),
                    tooltip(ModulationTooltip),
                    mirrorCursor(MOD_GROUP),
                    syncView(MOD_GROUP),
                    verticalRegions(() => MOD_REFERENCE_REGIONS),
                    verticalMarks(peakMarks),
                  ]}
                  onCreate={zoom.onReady}
                  data={data()}
                  series={[
                    {},
                    {
                      // Line only: an area fill would read as accumulated energy, which
                      // a relative-dB spectrum is not (M36, chart review items 9 and 11).
                      label: "AM",
                      stroke: chartTheme().series,
                      width: 1.5,
                      spanGaps: false,
                    },
                    {
                      label: "FM",
                      stroke: chartTheme().seriesMax,
                      width: 1.5,
                      spanGaps: false,
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
          </UplotChartPlot>

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
