/**
 * The theme registry and apply pipeline (M11) — the public surface.
 *
 * A theme is **data** — a `ThemeFile` (see `lib/themeFile.ts`) that overlays a
 * built-in **base** (`dark` / `light`). This module owns:
 *
 * - the **registry**: the built-in themes (authored under `themes/`, undeletable)
 *   plus any installed `.heyltheme` files read from the app config dir;
 * - the **preference**: a `mode` + two **slots** (`darkThemeId` / `lightThemeId`),
 *   so `auto` follows the OS to pick a slot while a forced mode pins one;
 * - the **apply pipeline**: `data-theme = base` selects the `src/styles/` baseline, the
 *   theme's `ui` overlay is written as inline custom properties on the root, and the
 *   `chart` / `colormap` / `flow` overlays are merged by their readers.
 *
 * Everything is app-level chrome, persisted in `localStorage` — a theme is **not**
 * part of the project file. See `docs/theming.md` and ADR-15.
 *
 * The implementation lives in sibling modules:
 * `chart.ts` (base chart palettes), `basePalettes.ts` (base ramp + flow),
 * `builtins.ts` + `builtin*.ts` (the bundled themes), `registry.ts` (built-ins +
 * installed), `apply.ts` (preference, slots, apply pipeline, overlay readers) and
 * `installed.ts` (the `.heyltheme` IPC).
 */

export { isBuiltinTheme, listThemeSummaries, themeById } from "./registry";

export {
  THEME_MODES,
  activeColormapStops,
  activeSlot,
  activeTheme,
  activeThemeId,
  chartTheme,
  resolvedTheme,
  setSlotTheme,
  setThemeMode,
  setThemePreference,
  themeFlow,
  themePreference,
  type ThemeMode,
  type ThemePreference,
} from "./apply";

export {
  deleteTheme,
  exportThemeFile,
  importThemeFile,
  pickThemeExportPath,
  pickThemeImportPath,
  refreshThemes,
  revealThemeDir,
  themeDir,
} from "./installed";
