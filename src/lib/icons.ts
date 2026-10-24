import type { AnalyzerView } from "../state/analyzer";

/**
 * The icon registry — a curated subset of **Font Awesome 7 Free (Solid)**.
 *
 * The glyphs ship in one bundled OTF (`public/fonts/fontawesome/`); each entry here
 * is the icon's Unicode code point (hex, no `\`). [`Icon`](../components/Icon.tsx)
 * renders the character with the `.fa` font (see `src/icons.css`), so this map is the
 * single source of truth — the CSS only needs `content: attr(data-icon)`.
 *
 * Keep the set curated (only what the UI uses) so dead glyphs don't accumulate.
 * Font Awesome Free: fonts SIL OFL 1.1, icons CC BY 4.0, code MIT — see the About
 * dialog and `docs/dependencies.md`.
 */
export const ICON_GLYPHS = {
  // --- Toolbar / chrome -------------------------------------------------------
  sliders: "f1de",
  filter: "f0b0",
  plug: "f1e6",
  "circle-question": "f059",
  "circle-half-stroke": "f042",
  sun: "f185",
  moon: "f186",
  minus: "f068",
  plus: "2b",
  xmark: "f00d",
  // --- Source / transport -----------------------------------------------------
  "folder-open": "f07c",
  "wand-magic-sparkles": "e2ca",
  "arrows-rotate": "f021",
  "record-vinyl": "f8d9",
  "circle-play": "f144",
  "circle-pause": "f28b",
  "circle-stop": "f28d",
  play: "f04b",
  stop: "f04d",
  headphones: "f025",
  desktop: "f390",
  "volume-high": "f028",
  "gauge-high": "f625",
  // --- Graph editors / charts -------------------------------------------------
  trash: "f1f8",
  "angle-down": "f107",
  "angle-right": "f105",
  "chevron-down": "f078",
  "chevron-up": "f077",
  pencil: "f303",
  "arrows-left-right-to-line": "e4ba",
  "arrow-up-right-from-square": "f08e",
  expand: "f065",
  "magnifying-glass": "f002",
  // --- Theme actions ----------------------------------------------------------
  copy: "f0c5",
  check: "f00c",
  "note-sticky": "f249",
  "file-import": "f56f",
  "file-export": "f56e",
  // --- Attribution ------------------------------------------------------------
  "font-awesome": "f2b4",
  link: "f0c1",
  // --- Chart types (see [`VIEW_ICONS`]) ---------------------------------------
  "chart-line": "f201",
  "chart-area": "f1fe",
  "wave-square": "f83e",
  "table-cells": "f00a",
  "table-list": "f00b",
} as const;

/** A registered icon name. */
export type IconName = keyof typeof ICON_GLYPHS;

/**
 * The chart-type icon for an analyzer, keyed by its **view kind** (`state/analyzer/`)
 * — a plain reflection of how the result is drawn, so two tools of the same chart
 * type share an icon.
 */
export const VIEW_ICONS: Record<AnalyzerView["kind"], IconName> = {
  /** Time-domain envelope. */
  waveform: "wave-square",
  /** A line/points track against time. */
  series: "chart-line",
  /** Magnitude against frequency (a line plot). */
  spectrum: "chart-line",
  /** A filled envelope with event markers. */
  rhythm: "chart-area",
  /** A frame × band heatmap (mel / MFCC / chroma / contrast). */
  matrix: "table-cells",
  /** A time × frequency heatmap. */
  spectrogram: "table-cells",
  /** A grid of numeric readouts, not a chart. */
  readouts: "table-list",
  /** A per-note table (M18). */
  noteMetrics: "table-list",
};

/** The icon for the two graph editors (a Sidebar row). */
export const GRAPH_ICONS: Record<"filter" | "synth", IconName> = {
  filter: "filter",
  synth: "wand-magic-sparkles",
};
