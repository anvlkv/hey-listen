import { createSignal } from "solid-js";
import type { ThemeFile, ThemeSummary } from "../../lib/themeFile";
import { BUILTIN_THEME_IDS, BUILTIN_THEMES } from "./builtins";

/**
 * The theme registry: the built-ins (authored in `builtins.ts`, undeletable) plus the
 * installed `.heyltheme` files the IPC layer (`installed.ts`) loads from the app
 * config dir.
 */

const [installedThemes, setInstalledThemes] = createSignal<ThemeFile[]>([]);

export { setInstalledThemes };

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
