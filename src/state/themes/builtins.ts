import type { ThemeFile } from "../../lib/themeFile";
import { BUILTIN_DARK, BUILTIN_LIGHT } from "./builtinDarkLight";
import { BUILTIN_NORD } from "./builtinNord";
import { BUILTIN_RETROWAVE_NEON } from "./builtinRetrowave";
import { BUILTIN_SOLARIZED_DARK, BUILTIN_SOLARIZED_LIGHT } from "./builtinSolarized";

/**
 * The bundled themes, in registry order: the two baselines first, then the themed
 * extras. Each is authored in its own module (their palettes are large literals);
 * this module is only the ordered assembly plus the id set the registry tests
 * membership against.
 */
export const BUILTIN_THEMES: ThemeFile[] = [
  BUILTIN_DARK,
  BUILTIN_LIGHT,
  BUILTIN_RETROWAVE_NEON,
  BUILTIN_NORD,
  BUILTIN_SOLARIZED_DARK,
  BUILTIN_SOLARIZED_LIGHT,
];

/** Every bundled theme id (undeletable), for quick membership tests. */
export const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((theme) => theme.meta.id));
