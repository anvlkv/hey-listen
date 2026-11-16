import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import { buildHeatmapImage, paintFrameGrid } from "./chartCanvas";
import { reactiveData } from "./verticalMarkers";
import { chartTheme } from "../../state/themes";
import type { AnalyzerBus } from "../../state/chartSync";
import type { DrilldownGrid } from "./drilldown";
import type { HeatmapScale } from "./heatmapScale";

/** The uPlot instance type, taken from the wrapper's plugin props. */
type Uplot = TooltipProps["u"];

/**
 * The offscreen `frames × rows` image the lane blits (row 0 = lowest). It lives beside
 * the lane rather than in `drilldown.ts`, so the normalisers stay pure — a canvas needs
 * a DOM, and their tests do not have one.
 */
export function drilldownImage(grid: DrilldownGrid, scale: HeatmapScale): HTMLCanvasElement | null {
  return buildHeatmapImage(
    grid.frames,
    grid.rows,
    0,
    1,
    (frame, row) => scale.position(grid.values[frame * grid.rows + row]),
    scale.ramp,
  );
}

/**
 * How much of the plot's height the drill-down lane takes. Enough to read a band
 * pattern, small enough that the scalar track keeps the panel.
 */
const LANE_SHARE = 0.25;

/** Options for the in-plot drill-down lane. */
export interface DrilldownLaneOptions {
  /** The grid the lane paints (its columns and rows); `null` paints nothing. */
  grid: () => DrilldownGrid | null;
  /** The pre-built `frames × rows` image (the caller owns the shared colour scale). */
  image: () => HTMLCanvasElement | null;
  /** Called when the pointer leaves the plot, so the hover card can hide. */
  onLeave: () => void;
}

/**
 * The **drill-down lane** (M38): a result's frame × band grid painted inside the timeline
 * chart's own plot box, along its bottom edge, on the chart's own time axis — no second
 * chart, x axis, colourbar or legend. It is the overview half of a drill-down; the
 * per-frame detail is the hover card (`DrilldownCard.tsx`).
 *
 * Painted in `drawClear`, so the axis grid stays readable over it; the trace keeps its
 * contrast through a background-coloured halo drawn in `drawAxes` (after the grid, before
 * the series) — the "cut-out" a spectrogram overlay would use, applied to a flat chart.
 * The lane follows a zoom for free, because `paintFrameGrid` reads the live x scale.
 */
export const drilldownLane =
  (opts: DrilldownLaneOptions): UplotPluginFactory<AnalyzerBus> =>
  () => {
    const image = reactiveData(opts.image, null as HTMLCanvasElement | null);
    let leave: (() => void) | undefined;

    /** The lane's box: the bottom share of the plot area. */
    const laneBox = (u: Uplot) => ({
      x: u.bbox.left,
      y: u.bbox.top + u.bbox.height * (1 - LANE_SHARE),
      width: u.bbox.width,
      height: u.bbox.height * LANE_SHARE,
    });

    return {
      hooks: {
        ready: (u) => {
          image.ready(u);
          leave = () => opts.onLeave();
          u.over?.addEventListener("pointerleave", leave);
        },
        drawClear: (u) => {
          const source = image.current();
          const grid = opts.grid();
          if (!grid || !u.ctx) return;
          const box = laneBox(u);
          u.ctx.save();
          // A backing tint first: on a light theme the ramp's low end is nearly the plot
          // colour, so an almost-empty frame would otherwise leave no register at all.
          u.ctx.fillStyle = chartTheme().gridFaint;
          u.ctx.fillRect(box.x, box.y, box.width, box.height);
          if (source) {
            u.ctx.globalAlpha = 0.88;
            paintFrameGrid(u.ctx, source, box, u, grid.times, grid.frames, grid.rows);
          }
          u.ctx.restore();
        },
        drawAxes: (u) => {
          const grid = opts.grid();
          if (!grid || !u.ctx) return;
          const box = laneBox(u);
          const { ctx } = u;
          ctx.save();
          // The register's own frame. A near-zero grid maps to the ramp's low end, which
          // on a light theme is almost the plot colour — the border is what keeps the
          // lane legible as a lane (it is chrome, never a value).
          ctx.strokeStyle = chartTheme().axis;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.strokeRect(
            Math.round(box.x) + 0.5,
            Math.round(box.y) + 0.5,
            Math.round(box.width) - 1,
            Math.round(box.height) - 1,
          );
          ctx.globalAlpha = 1;
          // The trace's halo: the plot background itself, so the line stays legible over
          // the heatmap without inventing a colour that would read as data.
          const xs = u.data[0];
          const ys = u.data[1];
          if (!xs || !ys) {
            ctx.restore();
            return;
          }
          const path = new Path2D();
          let open = false;
          for (let i = 0; i < xs.length; i++) {
            const value = ys[i];
            const x = xs[i];
            if (typeof value !== "number" || typeof x !== "number" || !Number.isFinite(value)) {
              open = false;
              continue;
            }
            const px = u.valToPos(x, "x", true);
            const py = u.valToPos(value, "y", true);
            if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
            if (open) path.lineTo(px, py);
            else path.moveTo(px, py);
            open = true;
          }
          ctx.strokeStyle = chartTheme().spectroBackground;
          ctx.lineWidth = 4;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.stroke(path);
          ctx.restore();
        },
        destroy: (u) => {
          if (leave) u.over?.removeEventListener("pointerleave", leave);
          image.destroy();
        },
      },
    };
  };
