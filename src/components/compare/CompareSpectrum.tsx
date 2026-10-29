import { SolidUplot } from "@dschz/solid-uplot";
import { cursor, tooltip, type TooltipProps } from "@dschz/solid-uplot/plugins";
import uPlot from "uplot";
import { Show } from "solid-js";
import Readout from "../analyzer/Readout";
import ChartTooltip from "../analyzer/ChartTooltip";
import { chartAxisStyle } from "../analyzer/chartCommon";
import {
  FREQ_AXIS_SPACE,
  frequencyAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  Y_AXIS_SPACE,
} from "../analyzer/axisFormat";
import { compareMarkers } from "./peerPlugins";
import { activeThemeId, chartTheme } from "../../state/themes";
import { analyzerBus } from "../../state/chartSync";
import { toolOptions, formatHz, type AnalyzerId, type SpectrumResult } from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, Span, SpectrumDiffDto } from "../../state/compare/types";

/** Keep a log x-axis strictly positive (band-limited data may start at 0 Hz). */
function logXRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 1;
  const hi = max > lo ? max : lo * 2;
  return [lo, hi];
}

const dB = (value: number) => `${value.toFixed(1)} dB`;

/** The compare spectrum's tooltip (frequency × dB), shared by both layouts. */
const Tip = (props: TooltipProps) => (
  <ChartTooltip
    {...props}
    xLabel="f"
    formatX={(value) => formatHz(value)}
    formatY={(value) => `${value.toFixed(1)} dB`}
  />
);

/**
 * The **spectrum** compare chart (M25): A and B's averaged magnitudes over one
 * frequency axis, with an optional Δ layer (B − A per bin). A differing grid shows the
 * two spectra side by side rather than interpolating one onto the other.
 */
export default function CompareSpectrum(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  swapped: boolean;
  live: CompareLiveHandle;
  bWindow: () => Span | null;
}) {
  const sideA = () => (props.swapped ? props.comparison.b : props.comparison.a);
  const sideB = () => (props.swapped ? props.comparison.a : props.comparison.b);
  const spectrumA = () => sideA().result as SpectrumResult | undefined;
  const spectrumB = () => sideB().result as SpectrumResult | undefined;
  const diff = (): SpectrumDiffDto | null =>
    props.comparison.diff?.kind === "spectrum" ? props.comparison.diff : null;
  const aligned = () => props.comparison.comparability.aligned;

  /** The spectrum's log-frequency toggle is a per-tool display option. */
  const logFreq = () => (toolOptions.spectrum?.logFreq ?? 1) !== 0;

  const markers = () =>
    compareMarkers({
      // Follow the displayed A/B (see CompareSeries).
      a: () => (props.swapped ? props.live.b() : props.live.a()),
      b: () => (props.swapped ? props.live.a() : props.live.b()),
      window: props.bWindow,
      axis: "freq",
    });

  const xScale = (): uPlot.Scale =>
    logFreq() ? { time: false, distr: 3, log: 10, range: logXRange } : { time: false };

  const yScale: uPlot.Scale = {
    // Keep roughly a 90 dB window in view, anchored on the peak.
    range: (_u: unknown, min: number, max: number): [number, number] => {
      const hi = Math.max(max, min + 6);
      return [Math.max(min, hi - 90), hi + 2];
    },
  };

  const overlay = () => {
    const a = spectrumA();
    const b = spectrumB();
    if (!a || !b) return null;
    const bins = Math.min(a.freqs.length, a.magDb.length, b.magDb.length);
    const delta = diff();
    return {
      freqs: a.freqs.slice(0, bins),
      a: a.magDb.slice(0, bins),
      b: b.magDb.slice(0, bins),
      delta: delta ? delta.values.slice(0, bins) : [],
    };
  };

  const series = () => {
    const data = overlay();
    const base = [
      {},
      { label: props.swapped ? "B" : "A", stroke: chartTheme().compareA, width: 1.2 },
      { label: props.swapped ? "A" : "B", stroke: chartTheme().compareB, width: 1.2 },
    ];
    if (!data || data.delta.length === 0) return base;
    return [
      ...base,
      {
        label: props.swapped ? "Δ (A − B)" : "Δ (B − A)",
        stroke: chartTheme().compareDelta,
        width: 1,
        dash: [5, 3],
      },
    ];
  };

  const chartData = (): uPlot.AlignedData => {
    const data = overlay();
    if (!data) return [[], [], []];
    const columns: uPlot.AlignedData = [data.freqs, data.a, data.b];
    if (data.delta.length > 0) columns.push(data.delta);
    return columns;
  };

  return (
    <div class="analyzer-chart compare-chart">
      <div class="analyzer-readouts">
        <Readout
          label="Δ mean"
          value={diff()?.stats.mean != null ? dB(diff()!.stats.mean!) : "—"}
        />
        <Readout
          label="max |Δ|"
          value={diff()?.stats.maxAbs != null ? dB(diff()!.stats.maxAbs!) : "—"}
        />
        <Readout label="Bins" value={diff() ? `${diff()!.freqs.length}` : "—"} />
        <Readout
          label="r"
          value={diff()?.stats.correlation != null ? diff()!.stats.correlation!.toFixed(3) : "—"}
          title="Pearson correlation between A and B over the matched bins"
        />
      </div>

      <Show
        when={aligned() && overlay()}
        fallback={
          <div class="compare-side-by-side">
            <SideSpectrum
              label={props.swapped ? "B" : "A"}
              color={chartTheme().compareA}
              spectrum={spectrumA()}
              xScale={xScale()}
              yScale={yScale}
              markers={markers}
            />
            <SideSpectrum
              label={props.swapped ? "A" : "B"}
              color={chartTheme().compareB}
              spectrum={spectrumB()}
              xScale={xScale()}
              yScale={yScale}
              markers={markers}
            />
          </div>
        }
      >
        <div class="analyzer-plot">
          <Show when={`${activeThemeId()}|${logFreq() ? "log" : "lin"}`} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[cursor(), tooltip(Tip), markers()]}
              data={chartData()}
              series={series()}
              scales={{ x: xScale(), y: yScale }}
              axes={[
                {
                  ...chartAxisStyle(),
                  label: "frequency (Hz)",
                  size: X_AXIS_SIZE,
                  space: FREQ_AXIS_SPACE,
                  values: frequencyAxisValues,
                },
                {
                  ...chartAxisStyle(),
                  label: "level (dB)",
                  size: Y_AXIS_SIZE,
                  space: Y_AXIS_SPACE,
                },
              ]}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** One side's own spectrum, used when the grids differ. */
function SideSpectrum(props: {
  label: string;
  color: string;
  spectrum: SpectrumResult | undefined;
  xScale: uPlot.Scale;
  yScale: uPlot.Scale;
  markers: () => ReturnType<typeof compareMarkers>;
}) {
  return (
    <div class="compare-side">
      <div class="compare-side-label" style={{ color: props.color }}>
        {props.label}
      </div>
      <Show
        when={props.spectrum}
        fallback={<div class="analyzer-empty">This project has no spectrum for the window.</div>}
      >
        {(spectrum) => (
          <Show when={activeThemeId()} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[props.markers()]}
              data={[spectrum().freqs, spectrum().magDb]}
              series={[{}, { label: props.label, stroke: props.color, width: 1.2 }]}
              scales={{ x: props.xScale, y: props.yScale }}
              axes={[
                {
                  ...chartAxisStyle(),
                  label: "frequency (Hz)",
                  size: X_AXIS_SIZE,
                  space: FREQ_AXIS_SPACE,
                  values: frequencyAxisValues,
                },
                {
                  ...chartAxisStyle(),
                  label: "level (dB)",
                  size: Y_AXIS_SIZE,
                  space: Y_AXIS_SPACE,
                },
              ]}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}
