/**
 * Shared Lighthouse-harness configuration.
 *
 * The surface list comes from the preview shell (`src/preview/surfaces.ts`) and the
 * themes from the registry (`src/state/themes/builtins.ts`), so neither matrix is
 * restated here. Only the laptop viewports and the category set are harness-owned.
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

/** A filesystem-safe slug for a theme id (`builtin:nord` → `nord`). */
export function themeSlug(id: string): string {
  return id.replace(/^builtin:/, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}
