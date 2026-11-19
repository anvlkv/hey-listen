import { SolidUplot } from "@dschz/solid-uplot";
import { cursor } from "@dschz/solid-uplot/plugins";
import { tooltip } from "../analyzer/tooltipPlugins";
import uPlot from "uplot";
import { Show } from "solid-js";
import Readout from "../analyzer/Readout";
import { chartAxisStyle, frequencyDbTooltip } from "../analyzer/chartCommon";
import { FREQ_AXIS_SPACE, X_AXIS_SIZE, Y_AXIS_SIZE, Y_AXIS_SPACE } from "../analyzer/axisFormat";
import {
  frequencyColumn,
  frequencyScaleAxisValues,
  frequencyScaleLabel,
  frequencyScaleOf,
  frequencyScaleXScale,
  type FrequencyScale,
} from "../analyzer/frequencyScale";
import { compareMarkers } from "./peerPlugins";
import CompareLegend from "./CompareLegend";
import { compareSides, liveMarkers } from "./sides";
import { spectrumCurve, type SpectrumCurve } from "./curves";
import type { CompareTime } from "./time";
import { activeThemeId, chartTheme } from "../../state/themes";
import { analyzerBus } from "../../state/chartSync";
import { toolOptions, type AnalyzerId, type AnyAnalysisResult } from "../../state/analyzer";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { ComparisonDto, SpectrumDiffDto } from "../../state/compare/types";

const dB = (value: number) => `${value.toFixed(1)} dB`;

/** The shared frequency / level axes (used by the overlay and each side's plot). */
const freqAxis = (scale: FrequencyScale) => ({
  ...chartAxisStyle(),
  label: frequencyScaleLabel(scale),
  size: X_AXIS_SIZE,
  space: FREQ_AXIS_SPACE,
  values: frequencyScaleAxisValues(scale),
});
const levelAxis = () => ({
  ...chartAxisStyle(),
  label: "level (dB)",
  size: Y_AXIS_SIZE,
  space: Y_AXIS_SPACE,
});

/**
 * The **spectrum** compare chart (M25): the two sides' curves over one frequency axis —
 * a spectrum's averaged magnitudes, or masking's SMR (see [`spectrumCurve`]) — with an
 * optional Δ layer (B − A per bin). A differing grid shows the two curves side by side
 * rather than interpolating one onto the other.
 */
export default function CompareSpectrum(props: {
  tool: AnalyzerId;
  comparison: ComparisonDto;
  live: CompareLiveHandle;
  /** The relative display transform (the markers ignore it on a frequency axis). */
  time: CompareTime;
}) {
  /* eslint-disable solid/reactivity -- both accessors are only read inside tracked scopes */
  const sides = compareSides<AnyAnalysisResult>(() => props.comparison);
  /* eslint-enable solid/reactivity */
  const curveA = () => spectrumCurve(sides.resultA());
  const curveB = () => spectrumCurve(sides.resultB());
  const diff = (): SpectrumDiffDto | null =>
    props.comparison.diff?.kind === "spectrum" ? props.comparison.diff : null;
  const aligned = sides.aligned;

  /**
   * The frequency scale is a per-tool display option: a tool that offers one owns it,
   * otherwise the comparison borrows the spectrum's (masking has no axis control).
   */
  const scale = () =>
    frequencyScaleOf(
      toolOptions[props.tool]?.frequencyScale ?? toolOptions.spectrum?.frequencyScale,
    );

  const markers = () =>
    compareMarkers(
      liveMarkers({
        live: props.live,
        time: props.time,
        axis: "freq",
      }),
    );

  const xScale = (): uPlot.Scale => frequencyScaleXScale(scale());

  const yScale: uPlot.Scale = {
    // Keep roughly a 90 dB window in view, anchored on the peak.
    range: (_u: unknown, min: number, max: number): [number, number] => {
      const hi = Math.max(max, min + 6);
      return [Math.max(min, hi - 90), hi + 2];
    },
  };

  const overlay = () => {
    const a = curveA();
    const b = curveB();
    if (!a || !b) return null;
    const bins = Math.min(a.freqs.length, a.values.length, b.values.length);
    const delta = diff();
    return {
      freqs: a.freqs.slice(0, bins),
      a: a.values.slice(0, bins),
      b: b.values.slice(0, bins),
      delta: delta ? delta.values.slice(0, bins) : [],
    };
  };

  const series = () => {
    const data = overlay();
    const base = [
      {},
      { label: "A", stroke: chartTheme().compareA, width: 1.2 },
      { label: "B", stroke: chartTheme().compareB, width: 1.2 },
    ];
    if (!data || data.delta.length === 0) return base;
    return [
      ...base,
      {
        label: "Δ (B − A)",
        stroke: chartTheme().compareDelta,
        width: 1,
        dash: [5, 3],
      },
    ];
  };

  const chartData = (): uPlot.AlignedData => {
    const data = overlay();
    if (!data) return [[], [], []];
    const columns: uPlot.AlignedData = [frequencyColumn(data.freqs, scale()), data.a, data.b];
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
        <Readout
          label="Curve"
          value={curveA()?.label ?? curveB()?.label ?? "—"}
          title="The quantity the chart and the Δ line plot"
        />
      </div>

      <CompareLegend
        delta={(overlay()?.delta.length ?? 0) > 0}
        aLabel={sides.a().project ?? "this project"}
        bLabel={sides.b().project ?? "reference"}
      />

      <Show
        when={aligned() && overlay()}
        fallback={
          <div class="compare-side-by-side">
            <SideSpectrum
              label="A"
              color={chartTheme().compareA}
              curve={curveA()}
              scale={scale()}
              xScale={xScale()}
              yScale={yScale}
              markers={markers}
            />
            <SideSpectrum
              label="B"
              color={chartTheme().compareB}
              curve={curveB()}
              scale={scale()}
              xScale={xScale()}
              yScale={yScale}
              markers={markers}
            />
          </div>
        }
      >
        <div class="analyzer-plot">
          <Show when={`${activeThemeId()}|${scale()}`} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[cursor(), tooltip(frequencyDbTooltip(scale)), markers()]}
              data={chartData()}
              series={series()}
              scales={{ x: xScale(), y: yScale }}
              axes={[freqAxis(scale()), levelAxis()]}
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
  curve: SpectrumCurve | null;
  scale: FrequencyScale;
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
        when={props.curve}
        fallback={<div class="analyzer-empty">This project has no spectrum for the window.</div>}
      >
        {(curve) => (
          <Show when={activeThemeId()} keyed>
            <SolidUplot
              autoResize
              pluginBus={analyzerBus}
              plugins={[props.markers()]}
              data={[frequencyColumn(curve().freqs, props.scale), curve().values]}
              series={[{}, { label: props.label, stroke: props.color, width: 1.2 }]}
              scales={{ x: props.xScale, y: props.yScale }}
              axes={[freqAxis(props.scale), levelAxis()]}
            />
          </Show>
        )}
      </Show>
    </div>
  );
}
