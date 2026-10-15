import { createSignal, untrack } from "solid-js";
import type { ChartTheme, ColorStop, ThemeBase, ThemeFile } from "../../lib/themeFile";
import { BASE_COLORMAP, BASE_FLOW } from "./basePalettes";
import { BUILTIN_THEMES } from "./builtins";
import { BASE_CHART } from "./chart";
import { themeById } from "./registry";

/**
 * The theme preference, slot resolution, apply pipeline and overlay readers.
 *
 * - the **preference**: a `mode` + two **slots** (`darkThemeId` / `lightThemeId`), so
 *   `auto` follows the OS to pick a slot while a forced mode pins one;
 * - the **apply pipeline**: `data-theme = base` selects the `src/styles/` baseline, the
 *   theme's `ui` overlay is written as inline custom properties on the root, and the
 *   `chart` / `colormap` / `flow` overlays are merged by their readers.
 *
 * Everything is app-level chrome, persisted in `localStorage` — a theme is **not**
 * part of the project file. See `docs/theming.md` and ADR-15.
 */

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
      mode:
        mode === "auto" || mode === "dark" || mode === "light"
          ? mode
          : DEFAULT_THEME_PREFERENCE.mode,
      darkThemeId:
        typeof parsed.darkThemeId === "string"
          ? parsed.darkThemeId
          : DEFAULT_THEME_PREFERENCE.darkThemeId,
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
 * The active theme's **base** — what `data-theme` selects in `src/styles/` and what the
 * dockview / `solid-flow` baseline follows.
 */
export function resolvedTheme(): ThemeBase {
  return activeTheme().meta.base;
}

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
// never flashes the default. Untracked: nothing here subscribes to the theme.
untrack(() => applyTheme());

darkQuery?.addEventListener("change", (event) => {
  setSystemDark(event.matches);
  applyTheme();
});

/** Persist the preference (best-effort) and re-apply it. */
export function commitPreference(preference: ThemePreference) {
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
