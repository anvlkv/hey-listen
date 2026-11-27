/// <reference types="@wdio/tauri-service" />
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as base } from "./wdio.conf.ts";

/**
 * WebdriverIO config for the **landing hero film capture** (M35.A) — not the E2E suite.
 *
 * Reuses `wdio.conf.ts` verbatim (the embedded `@wdio/tauri-service`, the stale-app guard,
 * fixtures and reporters) and only swaps `specs` for the single capture spec, then makes
 * sure the hero asset directories exist.
 *
 * Run with `npm run capture:hero`. Deliberately outside `e2e/specs/` so `npm run test:e2e`
 * (and CI, which runs only that directory) never picks it up: capturing the film is a
 * manual, GUI-only task.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** Where the captured hero frames and their manifest live (the Remotion story assets). */
const HERO_DIR = path.join(here, "video", "story-assets", "hero");

export const config: typeof base = {
  ...base,
  specs: ["./e2e/hero/capture.spec.ts"],
  // The scenario drives a full editor session (analyzers load, annotations, a theme
  // dissolve, a second window, the filter graph, MCP) and captures ~95 full-window PNGs,
  // so it runs far past the suite's 120 s analysis ceiling. Scope a longer timeout here
  // so `npm run test:e2e` keeps its tight one.
  mochaOpts: { ...base.mochaOpts, timeout: 20 * 60_000 },
  async onPrepare(config, capabilities) {
    // Keep the base behavior (kill stale apps, generate fixtures) intact. WDIO types a
    // hook as `Fn | Fn[]` (a config may chain hooks), so normalize before calling.
    const prepare = base.onPrepare;
    for (const hook of Array.isArray(prepare) ? prepare : prepare ? [prepare] : []) {
      await hook(config, capabilities);
    }
    await mkdir(path.join(HERO_DIR, "shots"), { recursive: true });
  },
};
