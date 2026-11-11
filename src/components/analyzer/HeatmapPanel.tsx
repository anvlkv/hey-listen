import { createEffect, createSignal, Show } from "solid-js";
import { SolidUplot } from "@dschz/solid-uplot";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import HeatmapColorScale from "./HeatmapColorScale";
import { chartAxisStyle } from "./chartCommon";
import { reactiveData, verticalMarks, type VerticalMark } from "./verticalMarkers";
import {
  TIME_AXIS_SPACE,
  timeAxisValues,
  X_AXIS_SIZE,
  Y_AXIS_SIZE,
  type AxisSelf,
} from "./axisFormat";
import { analyzerBus, type AnalyzerBus } from "../../state/chartSync";
import { activeThemeId } from "../../state/themes";
import type { PlotBox } from "./chartGeometry";
import type { HeatmapScale } from "./heatmapScale";

/** The uPlot instance type, taken from the wrapper's plugin props. */
type Uplot = TooltipProps["u"];

/** Paint an offscreen columns × rows image into the plot area (the caller owns the mapping). */
export type PaintHeatmap = (
  ctx: CanvasRenderingContext2D,
  box: PlotBox,
  image: HTMLCanvasElement,
  u: Uplot,
) => void;

/** One axis of a [`HeatmapPanel`]: a fixed extent plus uPlot tick formatting. */
export interface HeatmapAxis {
  /** The axis extent, already including half a cell at each end when relevant. */
  range: () => [number, number];
  /** A logarithmic distribution (a geometric rate grid). */
  log?: boolean;
  label: string;
  /** Tick-label formatter (an index axis is labelled in its physical unit here). */
  values: (self: AxisSelf, ticks: (number | null)[]) => string[];
  /** Target tick spacing, in px. */
  space: number;
}

/**
 * The time-axis descriptor shared by the read-only companion panels: source seconds,
 * labelled like every time chart. The range is an accessor so a panel can follow the
 * timeline chart's visible range.
 */
export function timeHeatmapAxis(range: () => [number, number]): HeatmapAxis {
  return { range, label: "time (s)", values: timeAxisValues, space: TIME_AXIS_SPACE };
}

/**
 * The x-range a companion panel shows: the timeline chart's shared visible range when
 * it covers a real span, else the panel's own frame extent. Reading a range never
 * publishes one, so a read-only panel cannot move the charts it follows.
 */
export function companionTimeRange(
  own: [number, number] | null,
  shared: () => [number, number] | null,
): [number, number] {
  const range = shared();
  if (range && range[1] > range[0]) return range;
  return own ?? [0, 1];
}

/**
 * The image layer: blit the heatmap under the axes and grid, and repaint when the
 * image changes (a new result, a theme switch, or the cursor's frame). It reuses
 * [`reactiveData`](./verticalMarkers.ts) so a plugin-driven repaint behaves exactly
 * like the shared vertical-mark plugins.
 */
const heatmapLayer =
  (
    getImage: () => HTMLCanvasElement | null,
    paint: PaintHeatmap,
  ): UplotPluginFactory<AnalyzerBus> =>
  () => {
    const image = reactiveData(getImage, null as HTMLCanvasElement | null);
    return {
      hooks: {
        ready: image.ready,
        drawClear: (u) => {
          const source = image.current();
          if (!source || !u.ctx) return;
          const box: PlotBox = {
            x: u.bbox.left,
            y: u.bbox.top,
            width: u.bbox.width,
            height: u.bbox.height,
          };
          u.ctx.save();
          paint(u.ctx, box, source, u);
          u.ctx.restore();
        },
        destroy: image.destroy,
      },
    };
  };

/**
 * A read-only heatmap companion below a chart (M36 drill-down): a fixed picture with
 * real uPlot axes, the shared vertical-mark plugin, and one [`HeatmapScale`] colourbar.
 *
 * The caller owns the pixels (`image` + `paint`) and both axes, so this module never
 * guesses whether the columns are frames, bands or modulation rates. The x extent is
 * an accessor because the caller may follow the timeline chart's shared zoom; uPlot
 * fixes `scales` at mount, so the panel re-applies it through `setScale()`.
 */
export default function HeatmapPanel(props: {
  /** The panel caption; an accessor so a cursor-selected frame can name itself. */
  title: () => string;
  image: () => HTMLCanvasElement | null;
  paint: PaintHeatmap;
  x: HeatmapAxis;
  y: HeatmapAxis;
  marks?: () => VerticalMark[];
  scale: HeatmapScale;
  scaleLabel: string;
  testid?: string;
}) {
  const [instance, setInstance] = createSignal<Uplot | null>(null);

  createEffect(() => {
    const u = instance();
    const [min, max] = props.x.range();
    if (u && max > min) u.setScale("x", { min, max });
  });

  return (
    <div class="heatmap-panel" data-testid={props.testid}>
      <span class="heatmap-panel-title">{props.title()}</span>
      <div class="heatmap-panel-plot">
        <Show when={activeThemeId()} keyed>
          <SolidUplot
            autoResize
            pluginBus={analyzerBus}
            plugins={[
              heatmapLayer(props.image, props.paint),
              ...(props.marks ? [verticalMarks(props.marks)] : []),
            ]}
            onCreate={(u) => setInstance(() => u)}
            data={[props.x.range()]}
            series={[{}]}
            // A read-only picture: no crosshair without a tooltip to read under it.
            cursor={{ show: false }}
            scales={{
              x: {
                time: false,
                range: props.x.range,
                ...(props.x.log ? { distr: 3, log: 10 } : {}),
              },
              y: { range: () => props.y.range() },
            }}
            axes={[
              {
                ...chartAxisStyle(),
                label: props.x.label,
                size: X_AXIS_SIZE,
                space: props.x.space,
                values: props.x.values,
              },
              {
                ...chartAxisStyle(),
                label: props.y.label,
                size: Y_AXIS_SIZE,
                space: props.y.space,
                values: props.y.values,
              },
            ]}
          />
        </Show>
      </div>
      <HeatmapColorScale scale={props.scale} label={props.scaleLabel} />
    </div>
  );
}
