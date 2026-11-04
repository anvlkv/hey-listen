/**
 * Shared Lighthouse-harness configuration.
 *
 * The surface list comes from the preview shell (`src/preview/surfaces.ts`) and the
 * themes from the registry (`src/state/themes/builtins.ts`), so neither matrix is
 * restated here. Only the profiles, laptop viewports, and category set are
 * harness-owned.
 *
 * Two profiles keep the run tractable:
 *
 * - **full** — every category, the neutral `builtin:dark` base theme, every surface,
 *   both laptop viewports. Layout/behaviour does not depend on a palette, so one
 *   theme is enough for performance / best-practices / SEO.
 * - **visual** — `color-contrast` only, every built-in theme, the surfaces that
 *   exercise the theme tokens, at one viewport. Colors are layout-independent for
 *   these elements, so the other themes do not need a full run.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_THEMES } from "../../src/state/themes/builtins";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The production build of `preview.html` (never `dist/`, which is the app). */
export const SITE_DIR = join(ROOT, ".lighthouse", "site");
export const REPORT_DIR = join(ROOT, "reports", "lighthouse");
export const BUDGETS_PATH = join(ROOT, "scripts", "lighthouse", "budgets.json");

/** Lighthouse categories this harness runs. */
export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
export type Category = (typeof CATEGORIES)[number];

/** A laptop viewport (CSS pixels; device scale 1 keeps the layout deterministic). */
export interface Viewport {
  id: string;
  width: number;
  height: number;
}

export const VIEWPORTS: Viewport[] = [
  { id: "small", width: 1280, height: 800 },
  { id: "large", width: 1920, height: 1080 },
];

/** Every bundled theme id, in registry order. */
export const THEMES: string[] = BUILTIN_THEMES.map((theme) => theme.meta.id);

/** The full-category baseline (the neutral dark base, not the app's default skin). */
export const BASELINE_THEME = THEMES[0];

/** The viewport for the color sweep (contrast does not change with laptop width). */
export const VISUAL_VIEWPORT = VIEWPORTS[0];

/**
 * Surfaces that together expose every theme-token consumer: the toolbar/sidebar/
 * source hero, the annotations rail, the About dialog, an analyzer readout, and the
 * graph palette. One viewport + `color-contrast` only keeps the sweep small.
 */
export const VISUAL_SURFACE_IDS = ["empty", "annotations", "about", "spectrum", "filter"];

/** The only audit the visual profile runs. */
export const VISUAL_AUDITS = ["color-contrast"] as const;

export type Profile = "full" | "visual";

/** A filesystem-safe slug for a theme id (`builtin:nord` → `nord`). */
export function themeSlug(id: string): string {
  return id.replace(/^builtin:/, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}
