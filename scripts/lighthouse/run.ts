#!/usr/bin/env -S npx tsx
/**
 * The Lighthouse audit harness (M32).
 *
 * Builds the preview shell for production (`HEYLISTEN_LIGHTHOUSE=1 vite build`),
 * serves it, then runs Lighthouse over every surface in `src/preview/surfaces.ts` ×
 * every built-in theme × the two laptop viewports. Reports land in
 * `reports/lighthouse/` (per-run JSON + HTML, plus `summary.json` and `index.html`).
 *
 *   npm run lighthouse                 # the full matrix
 *   npm run lighthouse -- --quick      # one theme, one viewport (iteration)
 *   npm run lighthouse -- --only=nord  # filter by surface / theme / viewport
 *   npm run lighthouse -- --no-build   # reuse the last preview build
 *   npm run lighthouse -- --check      # fail when a run misses a budget
 *
 * Serving the report is separate: `npm run lighthouse:serve`.
 */

import { readFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { serveStatic } from "../staticServer";
import { PREVIEW_SURFACES } from "../../src/preview/surfaces";
import { runLighthouse } from "./audit";
import {
  BUDGETS_PATH,
  CATEGORIES,
  REPORT_DIR,
  ROOT,
  SITE_DIR,
  THEMES,
  VIEWPORTS,
  themeSlug,
  type Viewport,
} from "./config";
import { buildSummary, writeReport, type RunSummary } from "./report";

interface Options {
  build: boolean;
  quick: boolean;
  check: boolean;
  only: string[];
  timeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    build: true,
    quick: false,
    check: false,
    only: [],
    timeoutMs: 180_000,
  };
  for (const arg of argv) {
    if (arg === "--no-build") options.build = false;
    else if (arg === "--quick") options.quick = true;
    else if (arg === "--check") options.check = true;
    else if (arg.startsWith("--only=")) options.only.push(arg.slice("--only=".length));
    else if (arg.startsWith("--timeout="))
      options.timeoutMs = Number(arg.slice("--timeout=".length));
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: npm run lighthouse -- [--quick] [--only=<text>]... [--no-build] [--check] [--timeout=<ms>]\n" +
          "  repeated --only terms must all match a run (surface, theme and viewport are concatenated)",
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

async function buildPreview() {
  process.env.HEYLISTEN_LIGHTHOUSE = "1";
  const { build } = await import("vite");
  await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), logLevel: "warn" });
}

/** Check every run against `scripts/lighthouse/budgets.json`. */
async function checkBudgets(runs: RunSummary[]): Promise<boolean> {
  let budgets: Record<string, number>;
  try {
    budgets = JSON.parse(await readFile(BUDGETS_PATH, "utf8")) as Record<string, number>;
  } catch (err) {
    console.error(`could not read budgets: ${String(err)}`);
    return false;
  }
  let failed = false;
  for (const category of CATEGORIES) {
    const budget = budgets[category];
    if (typeof budget !== "number") continue;
    for (const run of runs) {
      const score = run.scores[category];
      if (score == null) {
        console.error(`✖ ${run.surface}/${run.theme}/${run.viewport}: ${category} did not run`);
        failed = true;
      } else if (score < budget) {
        console.error(
          `✖ ${run.surface}/${run.theme}/${run.viewport}: ${category} ` +
            `${Math.round(score * 100)} < ${Math.round(budget * 100)}`,
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

  await rm(REPORT_DIR, { recursive: true, force: true });

  const themes = options.quick ? THEMES.slice(0, 1) : THEMES;
  const viewports: Viewport[] = options.quick ? VIEWPORTS.slice(0, 1) : VIEWPORTS;
  const surfaces = PREVIEW_SURFACES;
  const combos: { surface: (typeof surfaces)[number]; theme: string; viewport: Viewport }[] = [];
  for (const surface of surfaces) {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const haystack = `${surface.id} ${surface.title} ${surface.kind} ${theme} ${viewport.id}`;
        if (options.only.length > 0 && !options.only.every((text) => matchesOnly(text, haystack))) {
          continue;
        }
        combos.push({ surface, theme, viewport });
      }
    }
  }
  if (combos.length === 0) {
    console.error("no surface/theme/viewport matched --only");
    process.exit(2);
  }

  const server = await serveStatic(SITE_DIR);
  const runs: RunSummary[] = [];
  let lighthouseVersion: string | null = null;
  const started = Date.now();

  try {
    let index = 0;
    for (const { surface, theme, viewport } of combos) {
      index++;
      const outDir = join(REPORT_DIR, viewport.id, themeSlug(theme), surface.id);
      const outBase = join(outDir, "report");
      const url = `${server.url}/preview.html?fixture=${encodeURIComponent(surface.id)}&theme=${encodeURIComponent(theme)}`;
      process.stdout.write(
        `lighthouse [${index}/${combos.length}] ${surface.id} · ${themeSlug(theme)} · ${viewport.id} … `,
      );
      const result = await runLighthouse(url, outBase, viewport, options.timeoutMs);
      if (result.lighthouseVersion) lighthouseVersion = result.lighthouseVersion;
      runs.push({
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
  console.log(`\nlighthouse: ${runs.length} runs in ${seconds}s`);
  console.log(`  report → ${join(REPORT_DIR, "index.html")}`);
  console.log(`  serve  → npm run lighthouse:serve`);

  if (options.check) {
    const green = await checkBudgets(runs);
    if (!green) process.exitCode = 1;
    else console.log("lighthouse: every run is within the budgets");
  }
}

void main();
