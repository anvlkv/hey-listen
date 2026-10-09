import { resolvedTheme, type ResolvedTheme } from "../../state/settings";

/**
 * Piecewise-linear perceptually ordered colormap shared by the spectrogram and the
 * generic matrix heatmaps. Two variants so the heatmap reads well on either theme:
 *
 * - **dark** — dark → blue → teal → gold → white (low → high).
 * - **light** — white → pale blue → blue → deep navy (low → high), i.e. an
 *   inverted-lightness ramp so low values melt into the light background and high
 *   values stand out dark.
 */

type Stop = [number, number[]];

const DARK_STOPS: Stop[] = [
  [0.0, [10, 16, 40]],
  [0.25, [34, 80, 160]],
  [0.5, [46, 160, 160]],
  [0.75, [230, 200, 60]],
  [1.0, [255, 255, 235]],
];

const LIGHT_STOPS: Stop[] = [
  [0.0, [255, 255, 255]],
  [0.25, [207, 226, 250]],
  [0.5, [110, 168, 230]],
  [0.75, [40, 90, 170]],
  [1.0, [12, 26, 66]],
];

function sample(stops: Stop[], t: number): [number, number, number] {
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

/** The colormap for an explicit theme (used when the caller already knows it). */
export function spectroColormapFor(theme: ResolvedTheme, t: number): [number, number, number] {
  return sample(theme === "light" ? LIGHT_STOPS : DARK_STOPS, t);
}

/**
 * Theme-aware colormap. Reads [`resolvedTheme`] so callers that evaluate it inside a
 * memo/effect (the image builders) re-render the heatmap when the theme changes.
 */
export function spectroColormap(t: number): [number, number, number] {
  return spectroColormapFor(resolvedTheme(), t);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
