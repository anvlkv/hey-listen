import { onCleanup, untrack } from "solid-js";
import type { AnalyzerId } from "../../state/analyzer";
import {
  registerChartImage,
  unregisterChartImage,
  type ChartImageProvider,
} from "../../state/exportRegistry";

/** The part of a uPlot instance the PNG export needs. */
interface CanvasHost {
  ctx: { canvas: HTMLCanvasElement };
}

type ChartId = AnalyzerId | (() => AnalyzerId);

function registerChart(id: ChartId, provider: ChartImageProvider): void {
  const key = typeof id === "function" ? untrack(id) : id;
  registerChartImage(key, provider);
  onCleanup(() => unregisterChartImage(key, provider));
}

/**
 * Register a uPlot-backed chart's canvas as its PNG provider (M12) and drop it on
 * cleanup. `id` is fixed for a tab's lifetime, so it is read untracked.
 */
export function useUplotImage(id: ChartId, instance: () => CanvasHost | null | undefined): void {
  registerChart(id, () => instance()?.ctx.canvas ?? null);
}

/**
 * Register a plain-canvas chart (a heatmap) as its PNG provider (M12) and drop it on
 * cleanup.
 */
export function useCanvasImage(
  id: ChartId,
  canvas: () => HTMLCanvasElement | null | undefined,
): void {
  registerChart(id, () => canvas() ?? null);
}
