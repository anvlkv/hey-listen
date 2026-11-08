import { createSignal } from "solid-js";
import { createUplotReframeHandler } from "./chartCommon";
import { useUplotImage } from "./chartImage";
import type { ReframeTarget } from "./ReframeMenu";
import { createUplotZoom } from "./uplotZoom";
import type { AnalyzerId } from "../../state/analyzer";

/**
 * The shared scaffolding of a synced time-series chart (M5, M27): the `"time"`
 * zoom group, the reframe menu state, and the canvas registration the PNG export
 * needs.
 */
export function useTimeChart(id: () => AnalyzerId) {
  const zoom = createUplotZoom("time");
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);
  // Register the chart as its PNG provider, re-evaluated on demand (M12).
  useUplotImage(id, zoom.instance);
  const openMenu = createUplotReframeHandler(zoom, setMenu);
  return { zoom, menu, setMenu, openMenu };
}

/** The `[times, values]` pair a time chart consumes, or two empty arrays. */
export function timeSeriesData<T extends { times: number[] }>(
  result: T | null,
  values: (result: T) => (number | null)[],
): [number[], (number | null)[]] {
  if (!result || result.times.length === 0) return [[], []];
  return [result.times, values(result)];
}
