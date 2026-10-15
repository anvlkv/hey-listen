import type { ChartTheme, ThemeBase } from "../../lib/themeFile";

/**
 * The base chart palettes (M11).
 *
 * A [`ChartTheme`] is the single source of truth the uPlot and canvas charts read
 * instead of hardcoded colours. Its shape lives in `lib/themeFile.ts` (a theme
 * overlays a partial version of it); the two palettes here are the **bases** a
 * theme's `chart` overlay is merged onto.
 */

export type { ChartTheme };

/** The dark base chart palette. */
export const DARK_CHART: ChartTheme = {
  axis: "#8a8a8a",
  grid: "#2b2b2b",
  ticks: "#2b2b2b",
  font: "11px Inter, sans-serif",
  series: "#6ea8ff",
  seriesMin: "#6ee7a8",
  seriesMax: "#ff9d6e",
  seriesMean: "#6ea8ff",
  waveFill: "rgba(110, 168, 255, 0.22)",
  reference: "rgba(255, 209, 102, 0.75)",
  overlayCentroid: "#6ee7a8",
  overlayRolloff: "#ff9d6e",
  spectroBackground: "#1f1f1f",
  hover: "rgba(255, 255, 255, 0.7)",
  mirror: "rgba(120, 170, 255, 0.55)",
  background: "#171717",
  surface: "#1f1f1f",
  ruler: "#141414",
  rulerTick: "#333333",
  playhead: "#ffd166",
  midline: "rgba(255, 255, 255, 0.08)",
  note: "#e879f9",
  filtered: "#ffb454",
  handleFill: "rgba(88, 152, 255, 0.6)",
};

/** The light base chart palette. */
export const LIGHT_CHART: ChartTheme = {
  axis: "#6b7280",
  grid: "#e0e4e9",
  ticks: "#cbd0d7",
  font: "11px Inter, sans-serif",
  series: "#2f6fd0",
  seriesMin: "#1f9d6a",
  seriesMax: "#d9722f",
  seriesMean: "#2f6fd0",
  waveFill: "rgba(47, 111, 208, 0.2)",
  reference: "rgba(199, 120, 0, 0.8)",
  overlayCentroid: "#1f9d6a",
  overlayRolloff: "#d9722f",
  spectroBackground: "#ffffff",
  hover: "rgba(0, 0, 0, 0.65)",
  mirror: "rgba(47, 111, 208, 0.6)",
  background: "#f0f1f4",
  surface: "#ffffff",
  ruler: "#e8eaee",
  rulerTick: "#cbd0d7",
  playhead: "#c77800",
  midline: "rgba(0, 0, 0, 0.08)",
  note: "#a21caf",
  filtered: "#d9722f",
  handleFill: "rgba(47, 111, 208, 0.45)",
};

/** The base chart palettes, keyed by base. */
export const BASE_CHART: Record<ThemeBase, ChartTheme> = { dark: DARK_CHART, light: LIGHT_CHART };
