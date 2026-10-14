import { createSignal } from "solid-js";
import { invoke } from "../lib/ipc";
import type { InstalledTheme } from "../bindings/InstalledTheme";
import {
  parseThemeFile,
  serializeThemeFile,
  type ChartTheme,
  type ColorStop,
  type ThemeBase,
  type ThemeFile,
  type ThemeSummary,
} from "../lib/themeFile";

/**
 * The theme registry and apply pipeline (M11).
 *
 * A theme is **data** — a `ThemeFile` (see `lib/themeFile.ts`) that overlays a
 * built-in **base** (`dark` / `light`). This module owns:
 *
 * - the **registry**: the built-in themes (authored here, undeletable) plus any
 *   installed `.heyltheme` files read from the app config dir;
 * - the **preference**: a `mode` + two **slots** (`darkThemeId` / `lightThemeId`),
 *   so `auto` follows the OS to pick a slot while a forced mode pins one;
 * - the **apply pipeline**: `data-theme = base` selects the `App.css` baseline, the
 *   theme's `ui` overlay is written as inline custom properties on the root, and the
 *   `chart` / `colormap` / `flow` overlays are merged by their readers.
 *
 * Everything is app-level chrome, persisted in `localStorage` — a theme is **not**
 * part of the project file. See `docs/theming.md` and ADR-15.
 */

// ---------------------------------------------------------------------------
// Base palettes (the four sources a theme overlays)
// ---------------------------------------------------------------------------

/**
 * Chart palette for a base theme — the single source of truth the uPlot and canvas
 * charts read instead of hardcoded colours. The shape lives in `lib/themeFile.ts`
 * (a theme overlays a partial version of it).
 */
export type { ChartTheme };

const DARK_CHART: ChartTheme = {
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
  filtered: "#ffb454",
  handleFill: "rgba(88, 152, 255, 0.6)",
};

const LIGHT_CHART: ChartTheme = {
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
  filtered: "#d9722f",
  handleFill: "rgba(47, 111, 208, 0.45)",
};

/** The base chart palettes, keyed by base. */
const BASE_CHART: Record<ThemeBase, ChartTheme> = { dark: DARK_CHART, light: LIGHT_CHART };

/**
 * The base heatmap ramps, keyed by base (moved from `colormap.ts`, which now samples
 * the **active** theme's ramp with these as the fallback).
 *
 * - **dark** — dark → blue → teal → gold → white (low → high).
 * - **light** — white → pale blue → blue → deep navy (low → high), an
 *   inverted-lightness ramp so low values melt into the light background.
 */
const BASE_COLORMAP: Record<ThemeBase, ColorStop[]> = {
  dark: [
    [0.0, [10, 16, 40]],
    [0.25, [34, 80, 160]],
    [0.5, [46, 160, 160]],
    [0.75, [230, 200, 60]],
    [1.0, [255, 255, 235]],
  ],
  light: [
    [0.0, [255, 255, 255]],
    [0.25, [207, 226, 250]],
    [0.5, [110, 168, 230]],
    [0.75, [40, 90, 170]],
    [1.0, [12, 26, 66]],
  ],
};

/** The base `solid-flow` (`--xy-*`) styles, keyed by base (used by `GraphEditor`). */
const BASE_FLOW: Record<ThemeBase, Record<string, string>> = {
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

// ---------------------------------------------------------------------------
// Built-in (bundled) themes
// ---------------------------------------------------------------------------

/**
 * The bundled themes. `builtin:dark` / `builtin:light` carry the `App.css` baseline
 * (their `ui` is empty — the base block supplies every variable) plus the base chart,
 * ramp and flow; the themed extras overlay the same base with a `ui` / `chart` /
 * `colormap` / `flow` palette. All ids are `builtin:`-prefixed and undeletable.
 *
 * `db:builtin` — the ids/names/bases here are mirrored in `src-tauri/src/themes.rs`
 * (`BUILTIN_THEMES`) for the **headless** MCP surface, which has no webview. Keep
 * the two lists in sync when adding a bundled theme.
 */
const BUILTIN_THEMES: ThemeFile[] = [
  {
    kind: "hey-listen.theme",
    formatVersion: 1,
    meta: { id: "builtin:dark", name: "Dark", description: "The built-in dark palette.", base: "dark" },
    chart: DARK_CHART,
  },
  {
    kind: "hey-listen.theme",
    formatVersion: 1,
    meta: {
      id: "builtin:light",
      name: "Light",
      description: "The built-in light palette.",
      base: "light",
    },
    chart: LIGHT_CHART,
  },
  {
    kind: "hey-listen.theme",
    formatVersion: 1,
    meta: {
      id: "builtin:retrowave-neon",
      name: "Retrowave Neon",
      description: "Neon magenta and cyan on a deep purple night.",
      base: "dark",
    },
    ui: {
      "--bg": "#12081f",
      "--panel": "#1b0f2e",
      "--panel-2": "#241338",
      "--panel-3": "#2d1a44",
      "--panel-4": "#2a1640",
      "--control": "#3a2058",
      "--control-2": "#46286a",
      "--control-hover": "#52307a",
      "--control-hover-2": "#5e388a",
      "--track": "#160b26",
      "--splitter": "#1a0e2a",
      "--border": "#4a2a6e",
      "--border-strong": "#5b3585",
      "--border-2": "#6a3f9a",
      "--border-soft": "#3a2358",
      "--border-accent": "#b23bff",
      "--border-record": "#7a2a5a",
      "--border-record-2": "#6a2450",
      "--border-chip": "#7a3fa8",
      "--fg": "#f0e6ff",
      "--fg-strong": "#e6d8ff",
      "--fg-body": "#d8c8f0",
      "--fg-2": "#c8b4e6",
      "--fg-dim": "#a890cc",
      "--fg-muted": "#9a82bd",
      "--fg-faint": "#8a72ad",
      "--fg-faint-2": "#82689f",
      "--fg-disabled": "#6a5488",
      "--fg-accent": "#ff9de2",
      "--accent": "#ff4fd8",
      "--accent-2": "#2de2e6",
      "--accent-soft-fg": "#ffd6f5",
      "--knob": "#ff6ee0",
      "--switch-thumb": "#ff9de2",
      "--switch-thumb-on": "#2de2e6",
      "--primary-bg": "#4a1a6e",
      "--primary-bg-hover": "#5c2288",
      "--chip-bg": "#3a1f5c",
      "--chip-fg": "#ffc7f2",
      "--node-anchor-bg": "#3a1458",
      "--success": "#3ef0b0",
      "--warn": "#ffd166",
      "--warn-2": "#ffc04d",
      "--danger": "#ff5c8a",
      "--danger-fg": "#ffb3c8",
      "--danger-bg": "rgba(255, 92, 138, 0.14)",
      "--danger-border": "rgba(255, 92, 138, 0.4)",
      "--record-fg": "#ffd0e8",
      "--record-bg": "#4a1535",
      "--record-bg-hover": "#5c1a42",
      "--record-bg-2": "#3a1028",
      "--scroll-thumb": "#5b3585",
      "--scroll-thumb-hover": "#7a4fae",
      "--overlay-94": "rgba(36, 19, 56, 0.94)",
      "--overlay-92": "rgba(36, 19, 56, 0.92)",
      "--tooltip-bg": "rgba(20, 10, 34, 0.96)",
      "--busy-veil": "rgba(27, 15, 46, 0.35)",
      "--shadow": "rgba(80, 0, 120, 0.55)",
      "--shadow-strong": "rgba(80, 0, 120, 0.65)",
    },
    chart: {
      axis: "#a890cc",
      grid: "#3a2358",
      ticks: "#4a2a6e",
      series: "#2de2e6",
      seriesMin: "#3ef0b0",
      seriesMax: "#ff6ee0",
      seriesMean: "#ffd166",
      waveFill: "rgba(45, 226, 230, 0.22)",
      spectroBackground: "#1b0f2e",
      hover: "rgba(255, 157, 226, 0.8)",
      mirror: "rgba(255, 79, 216, 0.6)",
      background: "#12081f",
      surface: "#1b0f2e",
      ruler: "#160b26",
      rulerTick: "#4a2a6e",
      playhead: "#ff4fd8",
      filtered: "#ffb454",
      handleFill: "rgba(255, 79, 216, 0.6)",
    },
    colormap: {
      stops: [
        [0.0, [18, 8, 31]],
        [0.25, [92, 20, 122]],
        [0.5, [200, 30, 160]],
        [0.75, [255, 120, 60]],
        [1.0, [255, 245, 200]],
      ],
    },
    flow: {
      "--xy-background-color": "#1b0f2e",
      "--xy-background-pattern-dots-color": "#4a2a6e",
      "--xy-edge-stroke": "#ff4fd8",
      "--xy-edge-stroke-selected": "#2de2e6",
      "--xy-handle-background-color": "#2de2e6",
      "--xy-handle-border-color": "#1b0f2e",
      "--xy-connectionline-stroke": "#2de2e6",
      "--xy-controls-button-background-color": "#2d1a44",
      "--xy-controls-button-background-color-hover": "#3a2058",
      "--xy-controls-button-color": "#f0e6ff",
      "--xy-controls-button-color-hover": "#ffffff",
      "--xy-controls-button-border-color": "#4a2a6e",
      "--xy-minimap-background-color": "#160b26",
      "--xy-minimap-mask-background-color": "rgba(20, 8, 34, 0.65)",
      "--xy-minimap-mask-stroke-color": "#ff4fd8",
      "--xy-edge-label-background-color": "#2d1a44",
      "--xy-edge-label-color": "#f0e6ff",
    },
  },
  {
    kind: "hey-listen.theme",
    formatVersion: 1,
    meta: {
      id: "builtin:nord",
      name: "Nord",
      description: "Cool arctic blues — the Nord palette on a dark base.",
      base: "dark",
    },
    ui: {
      "--bg": "#2e3440",
      "--panel": "#2e3440",
      "--panel-2": "#3b4252",
      "--panel-3": "#434c5e",
      "--panel-4": "#3b4252",
      "--control": "#434c5e",
      "--control-2": "#4c566a",
      "--control-hover": "#4c566a",
      "--control-hover-2": "#5a6478",
      "--track": "#272c36",
      "--splitter": "#292e39",
      "--border": "#4c566a",
      "--border-strong": "#5a6478",
      "--border-2": "#6a7488",
      "--border-soft": "#434c5e",
      "--border-accent": "#5e81ac",
      "--border-record": "#7a4a4a",
      "--border-record-2": "#6a4242",
      "--border-chip": "#5e81ac",
      "--fg": "#eceff4",
      "--fg-strong": "#e5e9f0",
      "--fg-body": "#d8dee9",
      "--fg-2": "#c8d0dc",
      "--fg-dim": "#aab3c0",
      "--fg-muted": "#94a0b0",
      "--fg-faint": "#8894a4",
      "--fg-faint-2": "#808c9c",
      "--fg-disabled": "#6c7686",
      "--fg-accent": "#88c0d0",
      "--accent": "#88c0d0",
      "--accent-2": "#81a1c1",
      "--accent-soft-fg": "#e5f4f8",
      "--knob": "#eceff4",
      "--switch-thumb": "#88c0d0",
      "--switch-thumb-on": "#8fbcbb",
      "--primary-bg": "#3b5270",
      "--primary-bg-hover": "#45608a",
      "--chip-bg": "#3b4252",
      "--chip-fg": "#cfe3ef",
      "--node-anchor-bg": "#35435c",
      "--success": "#a3be8c",
      "--warn": "#ebcb8b",
      "--warn-2": "#d8b96a",
      "--danger": "#bf616a",
      "--danger-fg": "#d99aa0",
      "--record-fg": "#f0d0d0",
      "--record-bg": "#4a3236",
      "--record-bg-hover": "#5a3b40",
      "--record-bg-2": "#3a2a2e",
      "--scroll-thumb": "#4c566a",
      "--scroll-thumb-hover": "#5e6b82",
      "--overlay-94": "rgba(59, 66, 82, 0.94)",
      "--overlay-92": "rgba(59, 66, 82, 0.92)",
      "--tooltip-bg": "rgba(46, 52, 64, 0.96)",
      "--busy-veil": "rgba(46, 52, 64, 0.35)",
      "--shadow": "rgba(0, 0, 0, 0.5)",
      "--shadow-strong": "rgba(0, 0, 0, 0.6)",
    },
    chart: {
      axis: "#94a0b0",
      grid: "#434c5e",
      ticks: "#4c566a",
      series: "#88c0d0",
      seriesMin: "#a3be8c",
      seriesMax: "#d08770",
      seriesMean: "#81a1c1",
      waveFill: "rgba(136, 192, 208, 0.22)",
      spectroBackground: "#2e3440",
      hover: "rgba(236, 239, 244, 0.7)",
      mirror: "rgba(136, 192, 208, 0.6)",
      background: "#272c36",
      surface: "#3b4252",
      ruler: "#292e39",
      rulerTick: "#4c566a",
      playhead: "#ebcb8b",
      filtered: "#d08770",
      handleFill: "rgba(136, 192, 208, 0.6)",
    },
    colormap: {
      stops: [
        [0.0, [46, 52, 64]],
        [0.25, [94, 129, 172]],
        [0.5, [136, 192, 208]],
        [0.75, [163, 190, 140]],
        [1.0, [236, 239, 244]],
      ],
    },
    flow: {
      "--xy-background-color": "#3b4252",
      "--xy-background-pattern-dots-color": "#4c566a",
      "--xy-edge-stroke": "#88c0d0",
      "--xy-handle-background-color": "#88c0d0",
      "--xy-handle-border-color": "#2e3440",
      "--xy-connectionline-stroke": "#81a1c1",
      "--xy-controls-button-background-color": "#434c5e",
      "--xy-controls-button-color": "#eceff4",
      "--xy-controls-button-border-color": "#4c566a",
      "--xy-minimap-background-color": "#2e3440",
      "--xy-minimap-mask-stroke-color": "#88c0d0",
      "--xy-edge-label-background-color": "#434c5e",
      "--xy-edge-label-color": "#eceff4",
    },
  },
  {
    kind: "hey-listen.theme",
    formatVersion: 1,
    meta: {
      id: "builtin:solarized-dark",
      name: "Solarized Dark",
      description: "Ethan Schoonover's Solarized palette on a dark base.",
      base: "dark",
    },
    ui: {
      "--bg": "#002b36",
      "--panel": "#073642",
      "--panel-2": "#0a4150",
      "--panel-3": "#0e4b5a",
      "--panel-4": "#0a4150",
      "--control": "#12525f",
      "--control-2": "#175c6a",
      "--control-hover": "#1a6472",
      "--control-hover-2": "#226e7c",
      "--track": "#00252f",
      "--splitter": "#022b35",
      "--border": "#15525f",
      "--border-strong": "#1d6270",
      "--border-2": "#2b7180",
      "--border-soft": "#0e4453",
      "--border-accent": "#268bd2",
      "--border-record": "#7a3d3d",
      "--border-record-2": "#6a3535",
      "--border-chip": "#2aa198",
      "--fg": "#eee8d5",
      "--fg-strong": "#e4ddc8",
      "--fg-body": "#93a1a1",
      "--fg-2": "#8a9896",
      "--fg-dim": "#93a1a1",
      "--fg-muted": "#839496",
      "--fg-faint": "#78878a",
      "--fg-faint-2": "#718084",
      "--fg-disabled": "#5f7073",
      "--fg-accent": "#93d1e0",
      "--accent": "#268bd2",
      "--accent-2": "#2aa198",
      "--accent-soft-fg": "#cfeaf6",
      "--knob": "#eee8d5",
      "--switch-thumb": "#93a1a1",
      "--switch-thumb-on": "#2aa198",
      "--primary-bg": "#12455c",
      "--primary-bg-hover": "#155a76",
      "--chip-bg": "#0e3c48",
      "--chip-fg": "#b8dfe8",
      "--node-anchor-bg": "#0d3a4c",
      "--success": "#859900",
      "--warn": "#b58900",
      "--warn-2": "#cb9b00",
      "--danger": "#dc322f",
      "--danger-fg": "#e88a86",
      "--record-fg": "#f2c2c0",
      "--record-bg": "#4a1f1f",
      "--record-bg-hover": "#5a2626",
      "--record-bg-2": "#3a1818",
      "--scroll-thumb": "#15525f",
      "--scroll-thumb-hover": "#226e7c",
      "--overlay-94": "rgba(7, 54, 66, 0.94)",
      "--overlay-92": "rgba(7, 54, 66, 0.92)",
      "--tooltip-bg": "rgba(0, 43, 54, 0.96)",
      "--busy-veil": "rgba(7, 54, 66, 0.35)",
      "--shadow": "rgba(0, 0, 0, 0.5)",
      "--shadow-strong": "rgba(0, 0, 0, 0.6)",
    },
    chart: {
      axis: "#93a1a1",
      grid: "#15525f",
      ticks: "#15525f",
      series: "#268bd2",
      seriesMin: "#859900",
      seriesMax: "#cb4b16",
      seriesMean: "#2aa198",
      waveFill: "rgba(38, 139, 210, 0.22)",
      spectroBackground: "#073642",
      hover: "rgba(238, 232, 213, 0.7)",
      mirror: "rgba(42, 161, 152, 0.6)",
      background: "#002b36",
      surface: "#073642",
      ruler: "#00252f",
      rulerTick: "#15525f",
      playhead: "#b58900",
      filtered: "#cb4b16",
      handleFill: "rgba(38, 139, 210, 0.6)",
    },
    colormap: {
      stops: [
        [0.0, [0, 43, 54]],
        [0.25, [38, 139, 210]],
        [0.5, [42, 161, 152]],
        [0.75, [181, 137, 0]],
        [1.0, [253, 246, 227]],
      ],
    },
    flow: {
      "--xy-background-color": "#073642",
      "--xy-background-pattern-dots-color": "#15525f",
      "--xy-edge-stroke": "#268bd2",
      "--xy-handle-background-color": "#2aa198",
      "--xy-handle-border-color": "#002b36",
      "--xy-connectionline-stroke": "#2aa198",
      "--xy-controls-button-background-color": "#0e4b5a",
      "--xy-controls-button-color": "#eee8d5",
      "--xy-controls-button-border-color": "#15525f",
      "--xy-minimap-background-color": "#002b36",
      "--xy-minimap-mask-stroke-color": "#268bd2",
      "--xy-edge-label-background-color": "#0e4b5a",
      "--xy-edge-label-color": "#eee8d5",
    },
  },
  {
    kind: "hey-listen.theme",
    formatVersion: 1,
    meta: {
      id: "builtin:solarized-light",
      name: "Solarized Light",
      description: "Ethan Schoonover's Solarized palette on a light base.",
      base: "light",
    },
    ui: {
      "--bg": "#fdf6e3",
      "--panel": "#fdf6e3",
      "--panel-2": "#f7f0dd",
      "--panel-3": "#fffbef",
      "--panel-4": "#fdf6e3",
      "--control": "#eee8d5",
      "--control-2": "#e6dfc9",
      "--control-hover": "#e3ddc8",
      "--control-hover-2": "#d9d2ba",
      "--track": "#eee8d5",
      "--splitter": "#f0e9d5",
      "--border": "#ded8c4",
      "--border-strong": "#d0c9b4",
      "--border-2": "#c4bda8",
      "--border-soft": "#e6dfca",
      "--border-accent": "#a6c8e6",
      "--border-record": "#e8b3ae",
      "--border-record-2": "#dfa39d",
      "--border-chip": "#a9c8e0",
      "--fg": "#073642",
      "--fg-strong": "#0a4150",
      "--fg-body": "#586e75",
      "--fg-2": "#4a6169",
      "--fg-dim": "#657b83",
      "--fg-muted": "#71868d",
      "--fg-faint": "#7d9098",
      "--fg-faint-2": "#8598a0",
      "--fg-disabled": "#a0acb0",
      "--fg-accent": "#268bd2",
      "--accent": "#268bd2",
      "--accent-2": "#2aa198",
      "--accent-soft-fg": "#1b567f",
      "--knob": "#fdf6e3",
      "--switch-thumb": "#fdf6e3",
      "--switch-thumb-on": "#2aa198",
      "--primary-bg": "#dcebf8",
      "--primary-bg-hover": "#c9e0f5",
      "--chip-bg": "#e6eefb",
      "--chip-fg": "#1b567f",
      "--node-anchor-bg": "#dfecfa",
      "--success": "#728500",
      "--warn": "#9a6b00",
      "--warn-2": "#b39100",
      "--danger": "#c8362b",
      "--danger-fg": "#a3241a",
      "--record-fg": "#a3241a",
      "--record-bg": "#fdecea",
      "--record-bg-hover": "#fbdedb",
      "--record-bg-2": "#fdecea",
      "--scroll-thumb": "#c4bda8",
      "--scroll-thumb-hover": "#aca48d",
      "--overlay-94": "rgba(253, 246, 227, 0.94)",
      "--overlay-92": "rgba(253, 246, 227, 0.92)",
      "--tooltip-bg": "rgba(253, 246, 227, 0.97)",
      "--busy-veil": "rgba(253, 246, 227, 0.45)",
      "--shadow": "rgba(0, 0, 0, 0.16)",
      "--shadow-strong": "rgba(0, 0, 0, 0.2)",
    },
    chart: {
      axis: "#657b83",
      grid: "#e6dfca",
      ticks: "#d0c9b4",
      series: "#268bd2",
      seriesMin: "#728500",
      seriesMax: "#cb4b16",
      seriesMean: "#2aa198",
      waveFill: "rgba(38, 139, 210, 0.2)",
      spectroBackground: "#fdf6e3",
      hover: "rgba(7, 54, 66, 0.65)",
      mirror: "rgba(38, 139, 210, 0.6)",
      background: "#eee8d5",
      surface: "#fdf6e3",
      ruler: "#e6dfca",
      rulerTick: "#d0c9b4",
      playhead: "#b58900",
      filtered: "#cb4b16",
      handleFill: "rgba(38, 139, 210, 0.45)",
    },
    colormap: {
      stops: [
        [0.0, [253, 246, 227]],
        [0.25, [200, 224, 240]],
        [0.5, [108, 170, 220]],
        [0.75, [38, 110, 170]],
        [1.0, [7, 54, 66]],
      ],
    },
    flow: {
      "--xy-background-color": "#fdf6e3",
      "--xy-background-pattern-dots-color": "#d0c9b4",
      "--xy-edge-stroke": "#268bd2",
      "--xy-handle-background-color": "#268bd2",
      "--xy-handle-border-color": "#fdf6e3",
      "--xy-connectionline-stroke": "#2aa198",
      "--xy-controls-button-background-color": "#eee8d5",
      "--xy-controls-button-color": "#073642",
      "--xy-controls-button-border-color": "#ded8c4",
      "--xy-minimap-background-color": "#fdf6e3",
      "--xy-minimap-mask-stroke-color": "#268bd2",
      "--xy-edge-label-background-color": "#eee8d5",
      "--xy-edge-label-color": "#073642",
    },
  },
];

/** Every bundled theme id (undeletable), for quick membership tests. */
const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((theme) => theme.meta.id));

// ---------------------------------------------------------------------------
// Registry (built-ins + installed)
// ---------------------------------------------------------------------------

const [installedThemes, setInstalledThemes] = createSignal<ThemeFile[]>([]);

/** The full ordered registry: built-ins first, then installed themes. */
export function allThemes(): ThemeFile[] {
  return [...BUILTIN_THEMES, ...installedThemes()];
}

/** Whether `id` names a bundled theme (undeletable). */
export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_THEME_IDS.has(id);
}

/** Look up a theme by id across the whole registry. */
export function themeById(id: string): ThemeFile | undefined {
  return allThemes().find((theme) => theme.meta.id === id);
}

/** The compact identity of a theme (for pickers and agents). */
export function themeSummary(theme: ThemeFile): ThemeSummary {
  return { ...theme.meta, builtin: isBuiltinTheme(theme.meta.id) };
}

/** Every theme's compact identity, for the picker and the MCP surface. */
export function listThemeSummaries(): ThemeSummary[] {
  return allThemes().map(themeSummary);
}

// ---------------------------------------------------------------------------
// Preference: mode + two slots
// ---------------------------------------------------------------------------

/** A user preference; `auto` follows the OS colour scheme to pick a slot. */
export type ThemeMode = "auto" | "dark" | "light";
/** The two slots a theme can be assigned to. */
export type ThemeSlot = "dark" | "light";

/** The persisted theme preference: a mode plus the theme in each slot. */
export interface ThemePreference {
  mode: ThemeMode;
  darkThemeId: string;
  lightThemeId: string;
}

/** Selector order used by the Toolbar control. */
export const THEME_MODES: ThemeMode[] = ["auto", "dark", "light"];

/**
 * The default preference: retrowave neon in the dark slot, applied by default (mode
 * `dark`); the light slot keeps the built-in light palette for `auto` / `light`.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  mode: "dark",
  darkThemeId: "builtin:retrowave-neon",
  lightThemeId: "builtin:light",
};

const THEME_STORAGE_KEY = "hey-listen:theme";

function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_THEME_PREFERENCE };
    // Backward-compatible: the pre-M11 value was a bare mode string.
    if (raw === "auto" || raw === "dark" || raw === "light") {
      return { ...DEFAULT_THEME_PREFERENCE, mode: raw };
    }
    const parsed = JSON.parse(raw) as Partial<ThemePreference>;
    const mode = parsed.mode;
    return {
      mode: mode === "auto" || mode === "dark" || mode === "light" ? mode : DEFAULT_THEME_PREFERENCE.mode,
      darkThemeId:
        typeof parsed.darkThemeId === "string" ? parsed.darkThemeId : DEFAULT_THEME_PREFERENCE.darkThemeId,
      lightThemeId:
        typeof parsed.lightThemeId === "string"
          ? parsed.lightThemeId
          : DEFAULT_THEME_PREFERENCE.lightThemeId,
    };
  } catch {
    // Storage may be unavailable (e.g. private mode); fall back to the default.
    return { ...DEFAULT_THEME_PREFERENCE };
  }
}

const [themePreference, setThemePreferenceSignal] =
  createSignal<ThemePreference>(loadThemePreference());

export { themePreference };

// The OS scheme, tracked live so `auto` re-resolves when the system flips.
const darkQuery =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
const [systemDark, setSystemDark] = createSignal(darkQuery?.matches ?? true);

/** Which slot is active under the current mode (`auto` follows the OS). */
export function activeSlot(): ThemeSlot {
  const mode = themePreference().mode;
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemDark() ? "dark" : "light";
}

/** The id of the theme in the active slot. */
export function activeThemeId(): string {
  const preference = themePreference();
  return activeSlot() === "dark" ? preference.darkThemeId : preference.lightThemeId;
}

/**
 * The active theme: the one in the active slot, or the built-in for that slot's base
 * when a slot names a theme that is not (yet) loaded — so a new/dirty registry never
 * leaves the UI unpainted.
 */
export function activeTheme(): ThemeFile {
  const slot = activeSlot();
  const found = themeById(activeThemeId());
  if (found) return found;
  return slot === "dark" ? BUILTIN_THEMES[0] : BUILTIN_THEMES[1];
}

/**
 * The active theme's **base** — what `data-theme` selects in `App.css` and what the
 * dockview / `solid-flow` baseline follows.
 */
export function resolvedTheme(): ThemeBase {
  return activeTheme().meta.base;
}

// ---------------------------------------------------------------------------
// Apply pipeline
// ---------------------------------------------------------------------------

/** The inline custom properties the last apply wrote (cleared on the next apply). */
let appliedOverlay: string[] = [];

/** Push the active theme onto the document root (base + `ui` overlay). */
export function applyTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = activeTheme();

  root.dataset.theme = theme.meta.base;
  for (const name of appliedOverlay) root.style.removeProperty(name);
  appliedOverlay = [];
  for (const [name, value] of Object.entries(theme.ui ?? {})) {
    root.style.setProperty(name, value);
    appliedOverlay.push(name);
  }
}

// Apply eagerly at module load — built-ins are static, so a persisted preference
// never flashes the default.
applyTheme();

darkQuery?.addEventListener("change", (event) => {
  setSystemDark(event.matches);
  applyTheme();
});

/** Persist the preference (best-effort) and re-apply it. */
function commitPreference(preference: ThemePreference) {
  setThemePreferenceSignal(preference);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Not persisting is fine; the theme still applies for this session.
  }
  applyTheme();
}

/** Patch the preference (mode and/or slots) and re-apply. */
export function setThemePreference(patch: Partial<ThemePreference>) {
  commitPreference({ ...themePreference(), ...patch });
}

/** Set the mode (`auto` / `dark` / `light`). */
export function setThemeMode(mode: ThemeMode) {
  setThemePreference({ mode });
}

/** Assign a theme to a slot. */
export function setSlotTheme(slot: ThemeSlot, id: string) {
  setThemePreference(slot === "dark" ? { darkThemeId: id } : { lightThemeId: id });
}

// ---------------------------------------------------------------------------
// Overlay readers (chart / colormap / flow)
// ---------------------------------------------------------------------------

/** The chart palette for the active theme (base merged with its `chart` overlay). */
export function chartTheme(): ChartTheme {
  const theme = activeTheme();
  return { ...BASE_CHART[theme.meta.base], ...theme.chart };
}

/** The heatmap ramp for the active theme (its `colormap`, else the base ramp). */
export function activeColormapStops(): ColorStop[] {
  const theme = activeTheme();
  return theme.colormap?.stops ?? BASE_COLORMAP[theme.meta.base];
}

/** The `solid-flow` (`--xy-*`) style for the active theme (base merged with `flow`). */
export function themeFlow(): Record<string, string> {
  const theme = activeTheme();
  return { ...BASE_FLOW[theme.meta.base], ...(theme.flow as Record<string, string> | undefined) };
}

// ---------------------------------------------------------------------------
// Installed themes (IPC)
// ---------------------------------------------------------------------------

/** The themes directory (shown in the Appearance popover). */
export async function themeDir(): Promise<string> {
  return invoke<string>("theme_dir");
}

/** Re-read the installed themes from disk and re-apply the active one. */
export async function refreshThemes(): Promise<void> {
  try {
    const records = await invoke<InstalledTheme[]>("list_themes");
    const themes: ThemeFile[] = [];
    for (const record of records) {
      const parsed = parseThemeFile(record.content);
      if (parsed.ok) themes.push(parsed.theme);
      else console.warn(`ignoring theme ${record.id}: ${parsed.error}`);
    }
    setInstalledThemes(themes);
    applyTheme();
  } catch (err) {
    console.error("could not list themes", err);
  }
}

/** Copy a `.heyltheme` file into the themes directory and register it. */
export async function importThemeFile(path: string): Promise<ThemeSummary> {
  const content = await invoke<string>("import_theme_file", { path });
  const parsed = parseThemeFile(content);
  if (!parsed.ok) throw new Error(parsed.error);
  const theme = parsed.theme;
  await invoke("write_theme", { id: theme.meta.id, content: serializeThemeFile(theme) });
  await refreshThemes();
  return themeSummary(theme);
}

/** Write a theme out to `path` (its current JSON form). */
export async function exportThemeFile(id: string, path: string): Promise<void> {
  const theme = themeById(id);
  if (!theme) throw new Error(`unknown theme: ${id}`);
  await invoke("export_theme_file", { path, content: serializeThemeFile(theme) });
}

/** Remove an installed theme (built-ins are refused). */
export async function deleteTheme(id: string): Promise<void> {
  if (isBuiltinTheme(id)) throw new Error("built-in themes cannot be deleted");
  await invoke("delete_theme", { id });
  // Any slot pointing at the deleted theme falls back to the built-in for its base.
  const preference = { ...themePreference() };
  if (preference.darkThemeId === id) preference.darkThemeId = "builtin:dark";
  if (preference.lightThemeId === id) preference.lightThemeId = "builtin:light";
  await refreshThemes();
  commitPreference(preference);
}

/** Native dialog: pick a `.heyltheme` file to import (or `null` if cancelled). */
export async function pickThemeImportPath(): Promise<string | null> {
  return invoke<string | null>("pick_theme_import_path");
}

/** Native dialog: pick where to export a theme (or `null` if cancelled). */
export async function pickThemeExportPath(defaultName: string): Promise<string | null> {
  return invoke<string | null>("pick_theme_export_path", { defaultName });
}

/** Reveal the themes directory in the OS file manager. */
export async function revealThemeDir(): Promise<void> {
  await invoke("reveal_theme_dir");
}
