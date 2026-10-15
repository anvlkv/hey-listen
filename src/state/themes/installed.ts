import type { InstalledTheme } from "../../bindings/InstalledTheme";
import { invoke } from "../../lib/ipc";
import {
  parseThemeFile,
  serializeThemeFile,
  type ThemeFile,
  type ThemeSummary,
} from "../../lib/themeFile";
import { applyTheme, commitPreference, themePreference } from "./apply";
import { isBuiltinTheme, setInstalledThemes, themeById, themeSummary } from "./registry";

/**
 * The IPC-facing side of the theme system: reading/writing `.heyltheme` files through
 * the Rust `themes` commands (list, import, export, delete) and the native
 * file/directory pickers.
 */

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
