import type { ColorStop, ThemeBase } from "../../lib/themeFile";

/**
 * The non-chart base palettes — the heatmap ramps and the `solid-flow` (`--xy-*`)
 * styles a theme overlays, keyed by base.
 */

/**
 * The base heatmap ramps, keyed by base (moved from `colormap.ts`, which now samples
 * the **active** theme's ramp with these as the fallback).
 *
 * - **dark** — dark → blue → teal → gold → white (low → high).
 * - **light** — pale slate → blue → deep navy (low → high). The lowest stop is
 *   deliberately **not** the plot background: a low-energy band has to read as data,
 *   not as empty canvas (M36).
 *
 * `BASE_COLORMAP_DIVERGING` is the **signed** pair: a diverging ramp whose middle is
 * the domain's zero (MFCC coefficients), with the midpoint a neutral tone that is
 * still distinct from the plot background.
 */
export const BASE_COLORMAP: Record<ThemeBase, ColorStop[]> = {
  dark: [
    [0.0, [10, 16, 40]],
    [0.25, [34, 80, 160]],
    [0.5, [46, 160, 160]],
    [0.75, [230, 200, 60]],
    [1.0, [255, 255, 235]],
  ],
  light: [
    [0.0, [198, 213, 234]],
    [0.25, [140, 178, 220]],
    [0.5, [74, 130, 197]],
    [0.75, [30, 78, 154]],
    [1.0, [11, 26, 66]],
  ],
};

/** The base **diverging** heatmap ramps (negative → zero → positive), keyed by base. */
export const BASE_COLORMAP_DIVERGING: Record<ThemeBase, ColorStop[]> = {
  dark: [
    [0.0, [96, 156, 235]],
    [0.5, [52, 52, 58]],
    [1.0, [240, 166, 72]],
  ],
  light: [
    [0.0, [32, 84, 158]],
    [0.5, [222, 222, 218]],
    [1.0, [184, 66, 30]],
  ],
};

/** The base `solid-flow` (`--xy-*`) styles, keyed by base (used by `GraphEditor`). */
export const BASE_FLOW: Record<ThemeBase, Record<string, string>> = {
  dark: {
    "--xy-background-color": "#1f1f1f",
    "--xy-background-pattern-dots-color": "#3a3a3a",
    "--xy-edge-stroke": "#5898ff",
    "--xy-edge-stroke-width": "1.5",
    "--xy-edge-stroke-selected": "#9cc0ff",
    "--xy-handle-background-color": "#6ea8ff",
    "--xy-handle-border-color": "#1f1f1f",
    "--xy-connectionline-stroke": "#6ea8ff",
    "--xy-connectionline-stroke-width": "1.5",
    "--xy-controls-button-background-color": "#2b2b2b",
    "--xy-controls-button-background-color-hover": "#3e3e3e",
    "--xy-controls-button-color": "#e6e6e6",
    "--xy-controls-button-color-hover": "#ffffff",
    "--xy-controls-button-border-color": "#3c3c3c",
    "--xy-minimap-background-color": "#1a1a1a",
    "--xy-minimap-mask-background-color": "rgba(20, 20, 20, 0.65)",
    "--xy-minimap-mask-stroke-color": "#5898ff",
    "--xy-edge-label-background-color": "#2b2b2b",
    "--xy-edge-label-color": "#e6e6e6",
  },
  light: {
    "--xy-background-color": "#ffffff",
    "--xy-background-pattern-dots-color": "#d0d4da",
    "--xy-edge-stroke": "#2f6fd0",
    "--xy-edge-stroke-width": "1.5",
    "--xy-edge-stroke-selected": "#1b4fa0",
    "--xy-handle-background-color": "#2f6fd0",
    "--xy-handle-border-color": "#ffffff",
    "--xy-connectionline-stroke": "#2f6fd0",
    "--xy-connectionline-stroke-width": "1.5",
    "--xy-controls-button-background-color": "#ffffff",
    "--xy-controls-button-background-color-hover": "#eef0f4",
    "--xy-controls-button-color": "#1f2328",
    "--xy-controls-button-color-hover": "#000000",
    "--xy-controls-button-border-color": "#d8dce2",
    "--xy-minimap-background-color": "#f0f1f4",
    "--xy-minimap-mask-background-color": "rgba(160, 168, 178, 0.35)",
    "--xy-minimap-mask-stroke-color": "#2f6fd0",
    "--xy-edge-label-background-color": "#ffffff",
    "--xy-edge-label-color": "#1f2328",
  },
};
