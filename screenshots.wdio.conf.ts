/// <reference types="@wdio/tauri-service" />
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as base } from "./wdio.conf.ts";

/**
 * WebdriverIO config for the **landing screenshot capture** (not the E2E suite).
 *
 * It reuses `wdio.conf.ts` verbatim — same embedded `@wdio/tauri-service`,
 * `resetStaleApps` guard, fixtures, and reporters — and only swaps `specs` for the
 * single capture spec, plus ensures the landing's image directories exist.
 *
 * Run with `npm run landing:shots`. This is deliberately outside `e2e/specs/` so
 * `npm run test:e2e` (and CI, which runs only that directory's `*.spec.ts` files)
 * never pick it up: capturing landing PNGs is a manual, GUI-only task.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the landing's captured element crops live. */
const IMAGES_DIR = path.join(here, "landing", "public", "images");

export const config: typeof base = {
  ...base,
  specs: ["./e2e/screenshots/capture.spec.ts"],
  async onPrepare(config, capabilities) {
    // Keep the base behavior (kill stale apps, generate fixtures) intact. WDIO types
    // a hook as `Fn | Fn[]` (a config may chain hooks), so normalize before calling.
    const prepare = base.onPrepare;
    for (const hook of Array.isArray(prepare) ? prepare : prepare ? [prepare] : []) {
      await hook(config, capabilities);
    }
    await mkdir(path.join(IMAGES_DIR, "analyzers"), { recursive: true });
    await mkdir(path.join(IMAGES_DIR, "sources"), { recursive: true });
  },
};
