import { createSignal } from "solid-js";

/**
 * UI settings (app-level chrome preferences).
 *
 * Two concerns live here:
 *
 * - **Font scale** — a user-adjustable zoom for the whole interface (text and
 *   text-bearing controls), default `1` (100%), clamped to 0.8–1.4 in 0.05 steps.
 * - **Theme** — `auto` / `dark` / `light`, driving the UI palette (CSS custom
 *   properties), the charts (uPlot + canvas), and the dockview theme.
 *
 * Font scale is applied by writing `--ui-scale` on the document root; `App.css`
 * derives the root `font-size` from it, and text rules use `rem` (1rem = scaled
 * root). We deliberately do **not** use CSS `zoom`/`transform`: those would break
 * the Timeline 2D-canvas device-pixel-ratio math, `dockview` drag coordinates, and
 * uPlot sizing.
 *
 * The theme is applied by writing `data-theme` on the document root, which selects
 * the palette block in `App.css`; the charts read [`chartTheme`] instead of using
 * hardcoded colours.
 *
 * Both values are persisted in `localStorage` (read once at init, written on
 * change) so they survive reloads.
 */

/** Smallest supported scale (80%). */
export const FONT_SCALE_MIN = 0.8;
/** Largest supported scale (140%). */
export const FONT_SCALE_MAX = 1.4;
/** Increment used by the `A−` / `A+` toolbar buttons. */
export const FONT_SCALE_STEP = 0.05;

const STORAGE_KEY = "hey-listen:font-scale";

/** Clamp to `[MIN, MAX]` and snap to the step grid (avoids float drift). */
function clampScale(value: number): number {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
  const snapped = Math.round(clamped / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  return Number(snapped.toFixed(2));
}

function loadScale(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 1;
    const value = Number(raw);
    return Number.isFinite(value) ? clampScale(value) : 1;
  } catch {
    // Storage may be unavailable (e.g. private mode); fall back to the default.
    return 1;
  }
}

function applyFontScale(scale: number) {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  }
}

const [fontScale, setFontScaleSignal] = createSignal(loadScale());

// Apply eagerly at module load so a persisted scale never flashes the default.
applyFontScale(fontScale());

/** Set the UI font scale (clamped to `[MIN, MAX]`, snapped to `STEP`). */
export function setFontScale(value: number) {
  const scale = clampScale(value);
  applyFontScale(scale);
  setFontScaleSignal(scale);
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // Not persisting is fine; the scale still applies for this session.
  }
}

/** Nudge the scale by `direction` steps (e.g. `-1` / `+1`), clamped. */
export function nudgeFontScale(direction: number) {
  setFontScale(fontScale() + direction * FONT_SCALE_STEP);
}

/** Reset the scale back to the default (100%). */
export function resetFontScale() {
  setFontScale(1);
}

export { fontScale };

// ---------------------------------------------------------------------------
// Bottom row: Source panel visibility
// ---------------------------------------------------------------------------

/**
 * Whether the Source panel is force-shown while a source already exists, so the
 * user can replace it. The panel is shown automatically when there is no source
 * or while recording (see `App.tsx`), so this is only the "reveal it anyway"
 * override — transient, not persisted.
 */
export const [sourcePanelPinned, setSourcePanelPinned] = createSignal(false);

// ---------------------------------------------------------------------------
// Theme (auto / dark / light)
// ---------------------------------------------------------------------------

/** A user preference; `auto` follows the OS colour scheme. */
export type ThemePreference = "auto" | "dark" | "light";
/** The concrete theme a preference resolves to. */
export type ResolvedTheme = "dark" | "light";

/** Selector order used by the Toolbar control. */
export const THEME_PREFERENCES: ThemePreference[] = ["auto", "dark", "light"];

const THEME_STORAGE_KEY = "hey-listen:theme";

function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "auto" || raw === "dark" || raw === "light") return raw;
  } catch {
    // Storage may be unavailable (e.g. private mode); fall back to the default.
  }
  return "auto";
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

/**
 * The active theme: `dark`/`light` pass through, `auto` follows the OS scheme.
 * Reactive — reading it inside a component (or [`chartTheme`]) tracks theme
 * changes, so charts and the dockview can re-render when it flips.
 */
export function resolvedTheme(): ResolvedTheme {
  const preference = themePreference();
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemDark() ? "dark" : "light";
}

/** Write the resolved theme onto the document root (selects the CSS palette). */
function applyTheme() {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolvedTheme();
  }
}

// Apply eagerly at module load so a persisted preference never flashes the default.
applyTheme();

darkQuery?.addEventListener("change", (event) => {
  setSystemDark(event.matches);
  applyTheme();
});

/** Set the theme preference and re-apply it. Persisted to `localStorage`. */
export function setThemePreference(preference: ThemePreference) {
  setThemePreferenceSignal(preference);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not persisting is fine; the theme still applies for this session.
  }
  applyTheme();
}

/**
 * Chart palette for the active theme — the single source of truth the uPlot and
 * canvas charts read instead of hardcoded colours. Field names group the UI they
 * drive, not the tool that uses them.
 */
export interface ChartTheme {
  /** Axis/tick label text colour. */
  axis: string;
  /** Grid line colour. */
  grid: string;
  /** Tick mark colour. */
  ticks: string;
  /** Axis font (unchanged across themes). */
  font: string;
  /** Default line-series stroke. */
  series: string;
  /** Spectrum "min" layer stroke. */
  seriesMin: string;
  /** Spectrum "max" layer stroke. */
  seriesMax: string;
  /** Spectrum "mean" layer stroke. */
  seriesMean: string;
  /** Waveform envelope band fill. */
  waveFill: string;
  /** Canvas background behind a spectrogram/heatmap. */
  spectroBackground: string;
  /** Hover crosshair colour (canvas charts). */
  hover: string;
  /** Mirrored (synced) cursor colour (canvas charts). */
  mirror: string;
  /** Timeline/spectrogram full-canvas background. */
  background: string;
  /** Timeline waveform-area background. */
  surface: string;
  /** Timeline ruler background. */
  ruler: string;
  /** Timeline ruler tick colour. */
  rulerTick: string;
  /** Timeline playhead line colour. */
  playhead: string;
  /** Timeline mid-line colour. */
  midline: string;
  /** Timeline filtered-overlay stroke. */
  filtered: string;
  /** Timeline window move-handle fill (semi-transparent accent). */
  handleFill: string;
}

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

/** The chart palette for the current [`resolvedTheme`] (reactive). */
export function chartTheme(): ChartTheme {
  return resolvedTheme() === "light" ? LIGHT_CHART : DARK_CHART;
}
