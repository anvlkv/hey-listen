#!/usr/bin/env -S npx tsx
/**
 * The Lighthouse audit harness (M32).
 *
 * Builds the preview shell for production (`HEYLISTEN_LIGHTHOUSE=1 vite build`),
 * serves it, then runs two profiles:
 *
 * - **full** — every category on the neutral `builtin:dark` baseline, every surface,
 *   both laptop viewports. Layout/behaviour and performance do not depend on the
 *   palette, so one theme is enough.
 * - **visual** — `color-contrast` only, every built-in theme, the surfaces that expose
 *   the theme-token consumers, at 1280×800. Colors are layout-independent here.
 *
 * Reports land in `reports/lighthouse/` (per-run JSON + HTML, plus `summary.json` and
 * `index.html`). Serving is separate: `npm run lighthouse:serve`.
 *
 *   npm run lighthouse                    # full + visual profiles
 *   npm run lighthouse -- --quick         # one theme/viewport, both profiles
 *   npm run lighthouse -- --profile=full  # skip the theme contrast sweep
 *   npm run lighthouse -- --only=nord     # filter matrix entries
 *   npm run lighthouse -- --no-build      # reuse the last preview build
 *   npm run lighthouse -- --check         # apply the budgets
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import * as chromeLauncher from "chrome-launcher";
import { serveStatic } from "../staticServer";
import { PREVIEW_SURFACES, type PreviewSurface } from "../../src/preview/surfaces";
import { runLighthouse } from "./audit";
import {
  BASELINE_THEME,
  BUDGETS_PATH,
  CATEGORIES,
  REPORT_DIR,
  ROOT,
  SITE_DIR,
  THEMES,
  VIEWPORTS,
  VISUAL_AUDITS,
  VISUAL_SURFACE_IDS,
  VISUAL_VIEWPORT,
  themeSlug,
  type Profile,
  type Viewport,
} from "./config";
import { buildSummary, writeReport, type RunSummary } from "./report";

interface Options {
  build: boolean;
  quick: boolean;
  check: boolean;
  profile: Profile | "all";
  only: string[];
  timeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    build: true,
    quick: false,
    check: false,
    profile: "all",
    only: [],
    timeoutMs: 180_000,
  };
  for (const arg of argv) {
    if (arg === "--no-build") options.build = false;
    else if (arg === "--quick") options.quick = true;
    else if (arg === "--check") options.check = true;
    else if (arg.startsWith("--profile=")) {
      const profile = arg.slice("--profile=".length);
      if (profile !== "full" && profile !== "visual" && profile !== "all") {
        console.error(`unknown profile: ${profile} (expected full, visual, or all)`);
        process.exit(2);
      }
      options.profile = profile;
    } else if (arg.startsWith("--only=")) options.only.push(arg.slice("--only=".length));
    else if (arg.startsWith("--timeout="))
      options.timeoutMs = Number(arg.slice("--timeout=".length));
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: npm run lighthouse -- [--quick] [--profile=full|visual|all] [--only=<text>]...\n" +
          "                             [--no-build] [--check] [--timeout=<ms>]\n" +
          "  --only terms are ANDed; each is matched against profile + surface + theme + viewport",
      );
      process.exit(0);
    } else {
      console.error(`unknown option: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

function matchesOnly(text: string, haystack: string): boolean {
  if (text.length === 0) return true;
  return haystack.toLowerCase().includes(text.toLowerCase());
}

interface Combo {
  profile: Profile;
  surface: PreviewSurface;
  theme: string;
  viewport: Viewport;
}

/** Resolve the visual surface ids against the one surface list. */
function visualSurfaces(): PreviewSurface[] {
  const surfaces = PREVIEW_SURFACES.filter((surface) => VISUAL_SURFACE_IDS.includes(surface.id));
  const missing = VISUAL_SURFACE_IDS.filter((id) => !surfaces.some((surface) => surface.id === id));
  if (missing.length > 0) {
    throw new Error(`visual surfaces are missing from PREVIEW_SURFACES: ${missing.join(", ")}`);
  }
  return surfaces;
}

function buildCombos(options: Options): Combo[] {
  const fullViewports = options.quick ? VIEWPORTS.slice(0, 1) : VIEWPORTS;
  const visualThemes = options.quick ? [BASELINE_THEME] : THEMES;
  const full: Combo[] = PREVIEW_SURFACES.flatMap((surface) =>
    fullViewports.map((viewport) => ({
      profile: "full" as const,
      surface,
      theme: BASELINE_THEME,
      viewport,
    })),
  );
  const visual: Combo[] = visualSurfaces().flatMap((surface) =>
    visualThemes.map((theme) => ({
      profile: "visual" as const,
      surface,
      theme,
      viewport: VISUAL_VIEWPORT,
    })),
  );
  return [...full, ...visual]
    .filter((combo) => options.profile === "all" || combo.profile === options.profile)
    .filter((combo) => {
      if (options.only.length === 0) return true;
      const haystack = `${combo.profile} ${combo.surface.id} ${combo.surface.title} ${combo.surface.kind} ${combo.theme} ${combo.viewport.id}`;
      return options.only.every((text) => matchesOnly(text, haystack));
    });
}

async function buildPreview() {
  process.env.HEYLISTEN_LIGHTHOUSE = "1";
  const { build } = await import("vite");
  await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), logLevel: "warn" });
}

/** Check the full runs against category budgets and the visual runs against contrast. */
async function checkBudgets(runs: RunSummary[]): Promise<boolean> {
  let budgets: Record<string, number>;
  try {
    budgets = JSON.parse(await readFile(BUDGETS_PATH, "utf8")) as Record<string, number>;
  } catch (err) {
    console.error(`could not read budgets: ${String(err)}`);
    return false;
  }
  const contrastBudget = budgets.contrast ?? 1;
  let failed = false;
  for (const run of runs) {
    const where = `${run.profile}/${run.surface}/${run.theme}/${run.viewport}`;
    if (run.profile === "visual") {
      const score = run.contrast?.score;
      if (run.error != null || score == null) {
        console.error(`✖ ${where}: color-contrast did not run (${run.error ?? "missing"})`);
        failed = true;
      } else if (score < contrastBudget) {
        console.error(
          `✖ ${where}: color-contrast ${Math.round(score * 100)} < ${Math.round(contrastBudget * 100)} ` +
            `(${run.contrast?.failingNodes ?? 0} nodes, worst ${run.contrast?.worstRatio?.toFixed(2) ?? "–"})`,
        );
        failed = true;
      }
      continue;
    }
    for (const category of CATEGORIES) {
      const budget = budgets[category];
      if (typeof budget !== "number") continue;
      const score = run.scores[category];
      if (score == null) {
        console.error(`✖ ${where}: ${category} did not run`);
        failed = true;
      } else if (score < budget) {
        console.error(
          `✖ ${where}: ${category} ${Math.round(score * 100)} < ${Math.round(budget * 100)}`,
        );
        failed = true;
      }
    }
  }
  return !failed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.build) {
    console.log("lighthouse: building the preview shell …");
    await buildPreview();
  }

  // A crashed/killed prior run can leave its Chrome alive; it would compete for CPU
  // (and skew performance) while this matrix runs.
  const stale = chromeLauncher.killAll();
  if (stale.length > 0) console.log(`lighthouse: cleaned up ${stale.length} stale Chrome(s)`);

  await rm(REPORT_DIR, { recursive: true, force: true });

  const combos = buildCombos(options);
  if (combos.length === 0) {
    console.error("no profile/surface/theme/viewport matched --only");
    process.exit(2);
  }

  const server = await serveStatic(SITE_DIR);
  const runs: RunSummary[] = [];
  let lighthouseVersion: string | null = null;
  const started = Date.now();

  try {
    let index = 0;
    for (const { profile, surface, theme, viewport } of combos) {
      index++;
      const outDir = join(REPORT_DIR, profile, viewport.id, themeSlug(theme), surface.id);
      const outBase = join(outDir, "report");
      const url = `${server.url}/preview.html?fixture=${encodeURIComponent(surface.id)}&theme=${encodeURIComponent(theme)}`;
      process.stdout.write(
        `lighthouse [${index}/${combos.length}] ${profile} ${surface.id} · ${themeSlug(theme)} · ${viewport.id} … `,
      );
      const result = await runLighthouse(url, outBase, viewport, {
        timeoutMs: options.timeoutMs,
        onlyAudits: profile === "visual" ? VISUAL_AUDITS : undefined,
      });
      if (result.lighthouseVersion) lighthouseVersion = result.lighthouseVersion;
      runs.push({
        profile,
        surface: surface.id,
        title: surface.title,
        kind: surface.kind,
        theme,
        viewport: viewport.id,
        url,
        reportJson: `${outBase}.report.json`,
        reportHtml: `${outBase}.report.html`,
        ...result,
      });
      const summary =
        result.error != null
          ? `failed (${result.error.split("\n")[0]})`
          : profile === "visual"
            ? `contrast ${Math.round((result.contrast?.score ?? 0) * 100)} (${result.contrast?.failingNodes ?? 0} nodes)`
            : CATEGORIES.map((category) => Math.round((result.scores[category] ?? 0) * 100)).join(
                "/",
              );
      console.log(summary);
    }
  } finally {
    await server.close();
  }

  const summary = buildSummary(runs, lighthouseVersion);
  await writeReport(summary);

  const seconds = Math.round((Date.now() - started) / 1000);
  const fullCount = runs.filter((run) => run.profile === "full").length;
  const visualCount = runs.filter((run) => run.profile === "visual").length;
  console.log(
    `\nlighthouse: ${runs.length} runs in ${seconds}s (${fullCount} full, ${visualCount} color)`,
  );
  console.log(`  report → ${join(REPORT_DIR, "index.html")}`);
  console.log(`  serve  → npm run lighthouse:serve`);

  if (options.check) {
    const green = await checkBudgets(runs);
    if (!green) process.exitCode = 1;
    else console.log("lighthouse: every run is within the budgets");
  }
}

main().catch((err) => {
  console.error("lighthouse: failed", err);
  process.exitCode = 1;
});
