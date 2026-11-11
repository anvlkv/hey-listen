import { createMemo, Show, type Accessor } from "solid-js";
import ChartLegend, { type ChartLegendEntry } from "./chartLegend";
import HeatmapPanel, { type HeatmapAxis, type PaintHeatmap } from "./HeatmapPanel";
import { buildHeatmapImage } from "./chartCanvas";
import { resolveHeatmapScale } from "./heatmapScale";
import { bandIndexValues, formatFrequency, FREQ_AXIS_SPACE, Y_AXIS_SPACE } from "./axisFormat";
import { analyzerBus, readBusMessage } from "../../state/chartSync";
import { chartTheme } from "../../state/themes";
import type { RateContribution } from "../../bindings/RateContribution";
import {
  analyzerById,
  type AnalyzerId,
  type CalibratedSeriesResult,
  type SeriesResult,
  type SeriesView as SeriesViewConfig,
} from "../../state/analyzer";
import type { VerticalMark } from "./verticalMarkers";

/** The frame whose cells the matrix shows, and the time it sits at. */
interface FrameChoice {
  index: number;
  time: number | null;
}

/**
 * The band × modulation-rate drill-down for `roughness` and `fluctuationStrength`
 * (M36): one frame of the `rateContribution` grid, a band (rows, Hz) × rate (columns,
 * Hz) heatmap with the model's weighted rate marked.
 *
 * The frame is the one **nearest the shared `"time"` cursor** (the same bus the other
 * charts mirror); with no cursor it falls back to the window's strongest frame — the
 * frame with the largest scalar the grid decomposes. There is no second sync path:
 * the bus is read, never published, so the panel cannot move another chart.
 *
 * The rate axis is logarithmic because the engine's rate grid is geometric. The
 * pixels and the colourbar share one [`HeatmapScale`](./heatmapScale.ts); a tool
 * without a rate spectrum (or a stored result from before the field existed) renders
 * nothing.
 */
export default function RateMatrix(props: {
  id: AnalyzerId;
  result: Accessor<SeriesResult | null>;
}) {
  const grid = createMemo<RateContribution | null>(() => {
    const payload = (props.result() as Partial<CalibratedSeriesResult> | null)?.rateContribution;
    if (!payload) return null;
    const complete =
      payload.frames > 0 &&
      payload.bands > 0 &&
      payload.rates > 0 &&
      payload.bandHz.length >= payload.bands &&
      payload.rateHz.length >= payload.rates &&
      payload.values.length >= payload.frames * payload.bands * payload.rates;
    return complete ? payload : null;
  });

  /** The shared cursor time, or `null` when no time chart is hovered. */
  const cursorTime = createMemo<number | null>(() => {
    const message = readBusMessage(analyzerBus.data.cursorSync);
    return message && message.group === "time" ? message.x : null;
  });

  const frame = createMemo<FrameChoice>(() => {
    const contribution = grid();
    const series = props.result();
    if (!contribution) return { index: 0, time: null };
    const chosen = chooseFrame(contribution, series, cursorTime());
    return { index: chosen, time: series?.times[chosen] ?? null };
  });

  /** One scale for the whole grid, so the colours stay comparable across frames. */
  const panel = createMemo(() => {
    const contribution = grid();
    if (!contribution) return null;
    let max = 0;
    for (const value of contribution.values) {
      if (Number.isFinite(value) && value > max) max = value;
    }
    const scale = resolveHeatmapScale({ min: 0, max, unit: null });
    const start = frame().index * contribution.bands * contribution.rates;
    const image = buildHeatmapImage(
      contribution.rates,
      contribution.bands,
      0,
      1,
      (rate, band) => scale.position(contribution.values[start + band * contribution.rates + rate]),
      scale.ramp,
    );
    return image ? { scale, image } : null;
  });

  /** The model's weighted rate (descriptor data, never an id branch). */
  const target = (): number | undefined =>
    (analyzerById(props.id).view as SeriesViewConfig).rateTarget;

  const marks = (): VerticalMark[] => {
    const hz = target();
    return hz == null
      ? []
      : [
          {
            at: hz,
            label: `${formatFrequency(hz)} model weight`,
            color: chartTheme().reference,
            dash: [4, 3],
          },
        ];
  };

  /** Each rate column between its cell edges, so uneven rate grids stay aligned. */
  const paint: PaintHeatmap = (ctx, box, source, u) => {
    const contribution = grid();
    if (!contribution) return;
    const edges = rateEdges(contribution);
    ctx.imageSmoothingEnabled = false;
    for (let rate = 0; rate < contribution.rates; rate++) {
      const x = Math.max(box.x, Math.round(u.valToPos(edges[rate], "x", true)));
      const right = Math.min(box.x + box.width, Math.round(u.valToPos(edges[rate + 1], "x", true)));
      if (right > x) {
        ctx.drawImage(source, rate, 0, 1, contribution.bands, x, box.y, right - x, box.height);
      }
    }
    ctx.imageSmoothingEnabled = true;
  };

  const xAxis = (): HeatmapAxis => {
    const contribution = grid();
    const edges = contribution ? rateEdges(contribution) : [1, 100];
    return {
      range: () => [edges[0], edges[edges.length - 1]],
      log: true,
      label: "rate (Hz)",
      values: rateValues,
      space: FREQ_AXIS_SPACE,
    };
  };

  /** The band axis labels, kept as memo accessors so a new result relabels the ticks. */
  const bandCentres = createMemo(() => grid()?.bandHz ?? []);
  const bandCount = createMemo(() => grid()?.bands ?? 0);

  const yAxis = (): HeatmapAxis => ({
    range: () => [-0.5, bandCount() - 0.5],
    label: "band (Hz)",
    values: bandIndexValues(bandCentres, bandCount),
    space: Y_AXIS_SPACE,
  });

  const title = (): string => {
    const time = frame().time;
    return time == null ? "Band × rate" : `Band × rate · frame ${time.toFixed(3)} s`;
  };

  const legendEntries = (): ChartLegendEntry[] => {
    const hz = target();
    return hz == null
      ? []
      : [
          {
            label: `${formatFrequency(hz)} model weight`,
            color: chartTheme().reference,
            kind: "dashed",
          },
        ];
  };

  return (
    <Show when={panel()}>
      {(ready) => (
        <div class="rate-matrix">
          <HeatmapPanel
            testid="rateMatrix.panel"
            title={title}
            image={() => panel()?.image ?? null}
            paint={paint}
            x={xAxis()}
            y={yAxis()}
            marks={marks}
            scale={ready().scale}
            scaleLabel="fractional modulation depth"
          />
          <ChartLegend
            entries={legendEntries()}
            note="0 = steady · one frame of the band × rate grid (follows the shared cursor)"
          />
        </div>
      )}
    </Show>
  );
}

/** The frame nearest `time`, else the frame with the largest finite scalar value. */
function chooseFrame(
  contribution: RateContribution,
  series: SeriesResult | null,
  time: number | null,
): number {
  const times = series?.times ?? [];
  if (time != null && times.length > 0) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < times.length && i < contribution.frames; i++) {
      const distance = Math.abs(times[i] - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }
  const values = series?.values ?? [];
  let best = 0;
  let peak = -Infinity;
  for (let i = 0; i < values.length && i < contribution.frames; i++) {
    const value = values[i];
    if (value != null && value > peak) {
      peak = value;
      best = i;
    }
  }
  return best;
}

/** Cell edges on the rate grid (geometric midpoints, so a log axis spans whole cells). */
function rateEdges(contribution: RateContribution): number[] {
  const hz = contribution.rateHz;
  const count = contribution.rates;
  const midpoint = (low: number, high: number): number => Math.sqrt(low * high);
  const edges = new Array<number>(count + 1);
  edges[0] = count > 1 ? (hz[0] * hz[0]) / midpoint(hz[0], hz[1]) : hz[0] / 1.25;
  for (let i = 1; i < count; i++) edges[i] = midpoint(hz[i - 1], hz[i]);
  edges[count] =
    count > 1
      ? (hz[count - 1] * hz[count - 1]) / midpoint(hz[count - 2], hz[count - 1])
      : hz[0] * 1.25;
  return edges;
}

/** A rate tick in Hz (the axis is geometric, so the ticks are not evenly spaced in Hz). */
function rateValues(_self: unknown, ticks: (number | null)[]): string[] {
  return ticks.map((tick) => (tick == null ? "" : formatFrequency(tick)));
}
