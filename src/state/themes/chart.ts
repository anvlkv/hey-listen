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

/**
 * **Cursor and overlay roles.** Several marks are drawn on top of a chart at once, so the
 * palettes below hold each role at a hue of its own. (`overlayCentroid` and `reference`
 * share a green because no chart draws both — a reference line is a series/waveform mark,
 * a contour a spectrogram one.):
 *
 * - `hover` — where the pointer is (canvas cross + uPlot crosshair): neutral.
 * - `mirror` / `playhead` — the *live* rules; `mirror` is dashed, `playhead` solid.
 * - `reference` — a target/threshold rule (—14 LUFS, 0 dBFS): green.
 * - `overlayCentroid` / `overlayRolloff` — spectrogram contours: green / red-orange.
 * - `markerOnset` / `markerBeat` / `markerDownbeat` — rhythm markers: green / violet /
 *   crimson (the downbeat is drawn heavier).
 * - `note` — annotation anchors: magenta/violet.
 * - `select` — the drag-to-zoom tint.
 *
 * A theme that changes one must keep it distinct from the others it shares a chart with.
 */

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
  compareA: "#7fb4ff",
  compareB: "#ff8f6e",
  compareDelta: "#c084fc",
  waveFill: "rgba(110, 168, 255, 0.22)",
  reference: "rgba(110, 231, 168, 0.9)",
  overlayCentroid: "#6ee7a8",
  overlayRolloff: "rgba(246, 100, 90, 0.9)",
  spectroBackground: "#1f1f1f",
  hover: "rgba(255, 255, 255, 0.7)",
  mirror: "rgba(122, 214, 255, 0.85)",
  select: "rgba(110, 168, 255, 0.2)",
  background: "#171717",
  surface: "#1f1f1f",
  ruler: "#141414",
  rulerTick: "#333333",
  playhead: "#ffd166",
  midline: "rgba(255, 255, 255, 0.08)",
  note: "#e879f9",
  markerOnset: "rgba(120, 220, 150, 0.7)",
  markerBeat: "rgba(178, 155, 255, 0.75)",
  markerDownbeat: "rgba(255, 92, 122, 0.95)",
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
  compareA: "#2f6fd0",
  compareB: "#c2410c",
  compareDelta: "#7c3aed",
  waveFill: "rgba(47, 111, 208, 0.2)",
  reference: "rgba(31, 157, 106, 0.9)",
  overlayCentroid: "#1f9d6a",
  overlayRolloff: "rgba(206, 62, 52, 0.95)",
  spectroBackground: "#ffffff",
  hover: "rgba(0, 0, 0, 0.65)",
  mirror: "rgba(13, 132, 190, 0.85)",
  select: "rgba(47, 111, 208, 0.14)",
  background: "#f0f1f4",
  surface: "#ffffff",
  ruler: "#e8eaee",
  rulerTick: "#cbd0d7",
  playhead: "#c77800",
  midline: "rgba(0, 0, 0, 0.08)",
  note: "#a21caf",
  markerOnset: "rgba(18, 120, 68, 0.85)",
  markerBeat: "rgba(90, 60, 190, 0.75)",
  markerDownbeat: "rgba(198, 40, 62, 0.95)",
  filtered: "#d9722f",
  handleFill: "rgba(47, 111, 208, 0.45)",
};

/** The base chart palettes, keyed by base. */
export const BASE_CHART: Record<ThemeBase, ChartTheme> = { dark: DARK_CHART, light: LIGHT_CHART };
