import type { ColorStop } from "../../lib/themeFile";
import { activeColormapStops } from "../../state/themes";

/**
 * Piecewise-linear perceptually ordered colormap shared by the spectrogram and the
 * generic matrix heatmaps.
 *
 * The **ramp** now comes from the active theme (M11): a theme may carry its own
 * `colormap`, otherwise the base ramp for its `base` is used (dark → blue → teal →
 * gold → white; light → an inverted-lightness ramp so low values melt into the light
 * background). Both live in `state/themes/basePalettes.ts`, next to the rest of the palette.
 */

function sample(stops: ColorStop[], t: number): [number, number, number] {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
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

/**
 * Active-theme colormap. Reads the active theme, so callers that evaluate it inside a
 * memo/effect (the image builders) re-render the heatmap when the theme changes.
 */
export function spectroColormap(t: number): [number, number, number] {
  return sample(activeColormapStops(), t);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
