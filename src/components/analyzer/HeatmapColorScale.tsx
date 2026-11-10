import { Show } from "solid-js";
import type { HeatmapScale } from "./heatmapScale";

/** The ramp as a CSS gradient, sampled from the same stops the pixels use. */
function gradient(stops: HeatmapScale["stops"]): string {
  const parts = stops.map(([at, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${(at * 100).toFixed(1)}%`);
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/**
 * The colourbar for a matrix heatmap (M36).
 *
 * A compact strip along the chart's bottom edge: the active theme's ramp, labelled at
 * the domain's ends and its midpoint in the result's own unit. It renders the
 * [`HeatmapScale`](./heatmapScale.ts) the heatmap image was built from, so the bar and
 * the pixels use one mapping — the denominator cannot silently disagree with the image.
 */
export default function HeatmapColorScale(props: { scale: HeatmapScale; label?: string }) {
  return (
    <div class="heatmap-scale">
      <Show when={props.label}>
        <span class="heatmap-scale-label">{props.label}</span>
      </Show>
      <span class="heatmap-scale-ramp" style={{ background: gradient(props.scale.stops) }} />
      <span class="heatmap-scale-ticks">
        <span>{props.scale.formatter(props.scale.min)}</span>
        <span>{props.scale.formatter(props.scale.at(0.5))}</span>
        <span>{props.scale.formatter(props.scale.max)}</span>
      </span>
    </div>
  );
}
