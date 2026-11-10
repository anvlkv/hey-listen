import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ThemeFile } from "../src/lib/themeFile";
import { BUILTIN_NORD } from "../src/state/themes/builtinNord";
import { BUILTIN_RETROWAVE_NEON } from "../src/state/themes/builtinRetrowave";
import {
  BUILTIN_SOLARIZED_DARK,
  BUILTIN_SOLARIZED_LIGHT,
} from "../src/state/themes/builtinSolarized";
import { assertEqual, check, report } from "./testHarness";
import { contrast, parseRgb } from "./contrastColors";

/**
 * Contrast regression test for the secondary text tokens, runnable without a browser:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * The readable caption ramp (`--fg-muted` / `--fg-dim` / `--fg-faint`) must stay at
 * WCAG AA (≥ 4.5:1) on both of the surfaces those captions sit on. Each built-in theme
 * only overlays `ui` tokens, so it is merged over its base's values from `base.css` —
 * exactly what the picker applies at runtime. See `docs/theming.md`.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE_CSS = readFileSync(join(ROOT, "src/styles/base.css"), "utf8");

/** The custom properties declared inside one `:root[...]` block. */
function blockVars(match: RegExpMatchArray | null, selector: string): Record<string, string> {
  if (!match) throw new Error(`base.css declares no ${selector} block`);
  const vars: Record<string, string> = {};
  for (const declaration of match[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    vars[declaration[1]] = declaration[2].trim();
  }
  return vars;
}

const darkVars = blockVars(
  BASE_CSS.match(/:root,\s*:root\[data-theme="dark"\]\s*\{([^}]*)\}/),
  "dark",
);
const lightVars = blockVars(BASE_CSS.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/), "light");

const OVERLAYS: ThemeFile[] = [
  BUILTIN_NORD,
  BUILTIN_RETROWAVE_NEON,
  BUILTIN_SOLARIZED_DARK,
  BUILTIN_SOLARIZED_LIGHT,
];

/** The two base looks plus each built-in overlay merged over its base. */
const PALETTES: { name: string; vars: Record<string, string> }[] = [
  { name: "dark base", vars: darkVars },
  { name: "light base", vars: lightVars },
  ...OVERLAYS.map((theme) => ({
    name: theme.meta.name,
    vars: { ...(theme.meta.base === "dark" ? darkVars : lightVars), ...(theme.ui ?? {}) },
  })),
];

/** The secondary text tokens the UI uses for readable captions. */
const FG_TOKENS = ["--fg-muted", "--fg-dim", "--fg-faint"] as const;
/** The surfaces those captions sit on. */
const SURFACE_TOKENS = ["--panel-2", "--panel-3"] as const;
const MIN_CONTRAST = 4.5;

for (const palette of PALETTES) {
  for (const fg of FG_TOKENS) {
    for (const surface of SURFACE_TOKENS) {
      check(`${palette.name}: ${fg} on ${surface}`, () => {
        const ratio = contrast(parseRgb(palette.vars[fg]).rgb, parseRgb(palette.vars[surface]).rgb);
        assertEqual(
          ratio >= MIN_CONTRAST,
          true,
          `${palette.name} ${fg} on ${surface} is ${ratio.toFixed(2)}:1, needs ${MIN_CONTRAST}:1`,
        );
      });
    }
  }
}

report("themeContrast");
