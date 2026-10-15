import type { ThemeFile } from "../../lib/themeFile";
import { DARK_CHART, LIGHT_CHART } from "./chart";

/**
 * The two baseline bundled themes. `builtin:dark` / `builtin:light` carry the
 * `src/styles/` baseline (their `ui` is empty — the base block supplies every variable)
 * plus the base chart, ramp and flow; the themed extras overlay the same base with a
 * `ui` / `chart` / `colormap` / `flow` palette. All ids are `builtin:`-prefixed and
 * undeletable.
 *
 * `db:builtin` — the ids/names/bases here are mirrored in `src-tauri/src/themes.rs`
 * (`BUILTIN_THEMES`) for the **headless** MCP surface, which has no webview. Keep
 * the two lists in sync when adding a bundled theme.
 */

export const BUILTIN_DARK: ThemeFile = {
  kind: "hey-listen.theme",
  formatVersion: 1,
  meta: {
    id: "builtin:dark",
    name: "Dark",
    description: "The built-in dark palette.",
    base: "dark",
  },
  chart: DARK_CHART,
};

export const BUILTIN_LIGHT: ThemeFile = {
  kind: "hey-listen.theme",
  formatVersion: 1,
  meta: {
    id: "builtin:light",
    name: "Light",
    description: "The built-in light palette.",
    base: "light",
  },
  chart: LIGHT_CHART,
};
