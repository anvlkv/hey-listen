/**
 * One Lighthouse run through the Node API.
 *
 * The harness owns Chrome (`chrome-launcher`) and calls `lighthouse()` directly, so it
 * gets the **LHR** object back instead of re-reading a CLI JSON file, and renders the
 * official standalone HTML report with Lighthouse's own `ReportGenerator` (the same
 * renderer the CLI uses). A Chrome instance is launched per run so category scores
 * stay isolated; the desktop config is `lighthouse/core/config/desktop-config.js`
 * with only the screen size overridden.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { ReportGenerator } from "lighthouse/report/generator/report-generator.js";
import { CATEGORIES, type Category, type Viewport } from "./config";

/** A failing audit in one run. */
export interface AuditFailure {
  id: string;
  title: string;
  category: Category;
  score: number | null;
  displayValue: string | null;
}

/** The compact result of one Lighthouse run. */
export interface AuditResult {
  lighthouseVersion: string | null;
  scores: Record<Category, number | null>;
  metrics: Record<string, number | null>;
  failures: AuditFailure[];
  error: string | null;
}

type RunnerResult = NonNullable<Awaited<ReturnType<typeof lighthouse>>>;
type Lhr = RunnerResult["lhr"];

/** The performance metrics carried into the summary (numericValue, ms / unitless). */
const METRIC_IDS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
];

/** Score display modes that are not pass/fail audits. */
const NON_GRADED = new Set(["notApplicable", "informative", "manual", "error"]);

function chromeFlags(): string[] {
  return [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    ...(process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
  ];
}

/** The desktop preset, with the run's laptop viewport. */
function configFor(viewport: Viewport) {
  return {
    ...desktopConfig,
    settings: {
      ...desktopConfig.settings,
      formFactor: "desktop" as const,
      screenEmulation: {
        ...desktopConfig.settings?.screenEmulation,
        mobile: false,
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        disabled: false,
      },
    },
  };
}

/** Reject after `ms`, so a wedged Chrome cannot hang the matrix. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function parseLhr(lhr: Lhr): Omit<AuditResult, "error"> {
  const scores = Object.fromEntries(
    CATEGORIES.map((category) => [category, lhr.categories[category]?.score ?? null]),
  ) as Record<Category, number | null>;

  const metrics: Record<string, number | null> = {};
  for (const id of METRIC_IDS) {
    const value = lhr.audits[id]?.numericValue;
    metrics[id] = typeof value === "number" ? value : null;
  }

  const failures: AuditFailure[] = [];
  for (const category of CATEGORIES) {
    for (const ref of lhr.categories[category]?.auditRefs ?? []) {
      const audit = lhr.audits[ref.id];
      if (!audit || audit.score == null || audit.score >= 1) continue;
      if (NON_GRADED.has(audit.scoreDisplayMode ?? "")) continue;
      failures.push({
        id: ref.id,
        title: audit.title,
        category,
        score: audit.score,
        displayValue: audit.displayValue ?? null,
      });
    }
  }

  return { lighthouseVersion: lhr.lighthouseVersion, scores, metrics, failures };
}

function emptyResult(error: string): AuditResult {
  const scores = Object.fromEntries(CATEGORIES.map((category) => [category, null])) as Record<
    Category,
    number | null
  >;
  return { lighthouseVersion: null, scores, metrics: {}, failures: [], error };
}

/**
 * Run one audit into `outBase` (`<outBase>.report.html` / `.report.json`).
 * `outBase`'s directory must exist.
 */
export async function runLighthouse(
  url: string,
  outBase: string,
  viewport: Viewport,
  timeoutMs = 180_000,
): Promise<AuditResult> {
  await mkdir(dirname(outBase), { recursive: true });
  await rm(`${outBase}.report.json`, { force: true });
  await rm(`${outBase}.report.html`, { force: true });

  let chrome: chromeLauncher.LaunchedChrome | null = null;
  try {
    chrome = await chromeLauncher.launch({ chromeFlags: chromeFlags(), logLevel: "error" });
    const result = await withTimeout(
      lighthouse(
        url,
        {
          port: chrome.port,
          output: "json",
          logLevel: "error",
          onlyCategories: [...CATEGORIES],
        },
        configFor(viewport),
      ),
      timeoutMs,
    );
    if (!result) throw new Error("lighthouse returned no result");

    // The official renderer (report/generator/report-generator.js), not a custom one.
    await writeFile(`${outBase}.report.html`, ReportGenerator.generateReportHtml(result.lhr));
    await writeFile(`${outBase}.report.json`, JSON.stringify(result.lhr));
    return { ...parseLhr(result.lhr), error: null };
  } catch (err) {
    return emptyResult(err instanceof Error ? err.message : String(err));
  } finally {
    try {
      chrome?.kill();
    } catch {
      // Chrome already exited (e.g. after a timeout).
    }
  }
}
