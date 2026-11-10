import type { ColorStop } from "../../lib/themeFile";
import { activeColormapStops } from "../../state/themes";

/**
 * The **one** ramp sampler shared by every heatmap pixel and every colourbar.
 *
 * A theme carries up to two ramps (M36): a **sequential** one for unsigned
 * magnitudes (energy, loudness, level) and a **diverging** one for signed values
 * (MFCC coefficients), where the middle of the ramp is the domain's zero. Both live
 * in `state/themes/basePalettes.ts`, next to the rest of the palette, and a theme may
 * replace either. Sampling is a single function so the image
 * ([`HeatmapScale.ramp`](./heatmapScale.ts)) and the bar
 * ([`HeatmapColorScale`](./HeatmapColorScale.tsx)) cannot interpolate differently.
 */

/** The ramp family a heatmap uses. */
export type RampKind = "sequential" | "diverging";

/** Interpolate `t` (0…1) through ordered stops — the one ramp sampler. */
export function sampleRamp(stops: ColorStop[], t: number): [number, number, number] {
  const at = clamp01(t);
  for (let i = 1; i < stops.length; i++) {
    if (at <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = t1 > t0 ? (at - t0) / (t1 - t0) : 0;
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  const last = stops[stops.length - 1][1];
  return [last[0], last[1], last[2]];
}

/** A heatmap ramp's stops for the active theme (a theme's overlay, else its base). */
export function rampStops(kind: RampKind = "sequential"): ColorStop[] {
  return activeColormapStops(kind);
}

/**
 * The active theme's sequential ramp at `t` — the default for `buildHeatmapImage`.
 * Reads the active theme, so callers that evaluate it inside a memo/effect (the image
 * builders) re-render the heatmap when the theme changes.
 */
export function spectroColormap(t: number): [number, number, number] {
  return sampleRamp(rampStops("sequential"), t);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
