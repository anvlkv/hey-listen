/// <reference types="@wdio/tauri-service" />
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as base } from "./wdio.conf.ts";

/**
 * WebdriverIO config for the **manual screenshot capture** (not the E2E suite).
 *
 * Mirrors `screenshots.wdio.conf.ts`: it reuses `wdio.conf.ts` verbatim (same embedded
 * `@wdio/tauri-service`, stale-app guard, fixtures, and reporters) and only swaps
 * `specs` for the single capture spec, plus ensures `docs/manual/assets/` exists.
 *
 * Run with `npm run capture:manual`. Kept out of `e2e/specs/` so a normal run (and CI)
 * never captures documentation PNGs: this is a manual, GUI-only task.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the manual's element crops live. */
const ASSETS_DIR = path.join(here, "docs", "manual", "assets");

export const config: typeof base = {
  ...base,
  specs: ["./e2e/manual/capture.spec.ts"],
  async onPrepare(config, capabilities) {
    const prepare = base.onPrepare;
    for (const hook of Array.isArray(prepare) ? prepare : prepare ? [prepare] : []) {
      await hook(config, capabilities);
    }
    await mkdir(ASSETS_DIR, { recursive: true });
  },
};
