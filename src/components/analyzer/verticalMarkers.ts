import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import type { AnalyzerBus } from "../../state/chartSync";
import { chartTheme } from "../../state/themes";

/** The uPlot instance type, taken from the wrapper's plugin props. */
type Uplot = TooltipProps["u"];

/** A labelled vertical rule (a chosen tempo, a ranked modulation peak). */
export interface VerticalMark {
  /** The x value, in the chart's own axis unit. */
  at: number;
  /** The caption drawn beside the rule; omit for an unlabelled tick. */
  label?: string;
  /** A `chartTheme()` role resolved by the caller, never a literal. */
  color: string;
  dash?: number[];
}

/**
 * A **reference region** of the x-axis (a model's sensitive band). Described as a
 * region, never as a decision boundary: it shows where a model is most sensitive, and
 * the caption says so.
 */
export interface VerticalRegion {
  from: number;
  to: number;
  label: string;
}

/**
 * Keep a plugin's captured description in sync with a reactive accessor and repaint on
 * change. The chart is built once (the wrapper fixes its series at mount), so a new
 * result has to reach the draw hook without rebuilding it.
 */
export function reactiveData<T>(get: () => T, initial: T) {
  let value = initial;
  let dispose: (() => void) | undefined;
  return {
    current: () => value,
    ready: (u: Uplot) => {
      dispose = createRoot((root) => {
        createEffect(() => {
          value = get();
          u.redraw();
        });
        return root;
      });
    },
    destroy: () => dispose?.(),
  };
}

/**
 * Labelled vertical rules on a chart's x-axis (M36): the chosen tempo on the tempogram,
 * the ranked AM/FM rates on a modulation spectrum. Placed through `u.valToPos()`, so the
 * marks follow a zoom or pan; the canvas state is saved and restored around them.
 */
export const verticalMarks =
  (getMarks: () => VerticalMark[]): UplotPluginFactory<AnalyzerBus> =>
  () => {
    const marks = reactiveData(getMarks, [] as VerticalMark[]);
    return {
      hooks: {
        ready: marks.ready,
        draw: (u) => {
          if (!u.ctx) return;
          const { ctx, bbox } = u;
          const right = bbox.left + bbox.width;
          for (const mark of marks.current()) {
            const x = u.valToPos(mark.at, "x", true);
            if (!Number.isFinite(x) || x < bbox.left || x > right) continue;
            const px = Math.round(x) + 0.5;
            // Flip the label inward near the right edge so it is never clipped.
            const flip = x > right - 56;
            ctx.save();
            ctx.strokeStyle = mark.color;
            ctx.lineWidth = 1.5;
            ctx.setLineDash(mark.dash ?? []);
            ctx.beginPath();
            ctx.moveTo(px, bbox.top);
            ctx.lineTo(px, bbox.top + bbox.height);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = chartTheme().font;
            ctx.fillStyle = mark.color;
            ctx.textBaseline = "top";
            ctx.textAlign = flip ? "right" : "left";
            if (mark.label) ctx.fillText(mark.label, px + (flip ? -4 : 4), bbox.top + 3);
            ctx.restore();
          }
        },
        destroy: marks.destroy,
      },
    };
  };

/**
 * Shaded vertical **reference regions** behind the series (M36): a modulation model's
 * sensitive bands, captioned in place. Drawn in `drawClear`, so they sit under the data
 * and its grid; `save()` / `restore()` keeps the canvas state clean.
 */
export const verticalRegions =
  (getRegions: () => VerticalRegion[]): UplotPluginFactory<AnalyzerBus> =>
  () => {
    const regions = reactiveData(getRegions, [] as VerticalRegion[]);
    return {
      hooks: {
        ready: regions.ready,
        drawClear: (u) => {
          const list = regions.current();
          if (!u.ctx || list.length === 0) return;
          const { ctx, bbox } = u;
          const left = bbox.left;
          const right = left + bbox.width;
          /** A region's clipped pixel span, or `null` when it is off-screen. */
          const span = (region: VerticalRegion): [number, number] | null => {
            const a = u.valToPos(region.from, "x", true);
            const b = u.valToPos(region.to, "x", true);
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            const lo = Math.max(left, Math.min(a, b));
            const hi = Math.min(right, Math.max(a, b));
            return hi > lo ? [lo, hi] : null;
          };
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, bbox.top, bbox.width, bbox.height);
          ctx.clip();
          ctx.fillStyle = chartTheme().grid;
          ctx.globalAlpha = 0.5;
          for (const region of list) {
            const clipped = span(region);
            if (clipped) ctx.fillRect(clipped[0], bbox.top, clipped[1] - clipped[0], bbox.height);
          }
          ctx.globalAlpha = 1;
          ctx.font = chartTheme().font;
          ctx.fillStyle = chartTheme().axis;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          for (const region of list) {
            const clipped = span(region);
            // Only caption a region with room for the words; the tooltip explains the rest.
            if (!clipped || clipped[1] - clipped[0] < 56) continue;
            ctx.fillText(region.label, (clipped[0] + clipped[1]) / 2, bbox.top + bbox.height - 3);
          }
          ctx.restore();
        },
        destroy: regions.destroy,
      },
    };
  };
