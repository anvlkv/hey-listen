/// <reference types="@wdio/tauri-service" />
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as base } from "./wdio.conf.ts";

/**
 * WebdriverIO config for the **marketing screenshot capture** (not the E2E suite).
 *
 * It reuses `wdio.conf.ts` verbatim — same embedded `@wdio/tauri-service`,
 * `resetStaleApps` guard, fixtures, and reporters — and only swaps `specs` for the
 * single capture spec, plus ensures `site/assets/` exists before the run.
 *
 * Run with `npm run screenshots`. This is deliberately outside `e2e/specs/` so
 * `npm run test:e2e` (and CI, which runs only that directory's `*.spec.ts` files)
 * never pick it up: capturing marketing PNGs is a manual, GUI-only task, not a test.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the marketing PNGs (+ the copied app icon) live. */
const ASSETS_DIR = path.join(here, "site", "assets");

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
    await mkdir(ASSETS_DIR, { recursive: true });
  },
};
