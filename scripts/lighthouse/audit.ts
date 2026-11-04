/**
 * One Lighthouse run: launch the CLI against a preview surface, then read the JSON
 * report back into the compact shape the aggregate report uses.
 *
 * The CLI (not the user-flow API) is deliberate: a fresh Chrome per audit is the
 * cleanest way to keep category scores comparable across 200 runs, and the preview
 * shell settles before the load event, so no custom page interaction is needed.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { CATEGORIES, LIGHTHOUSE_CLI, type Category, type Viewport } from "./config";

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

interface ReportAudit {
  score?: number | null;
  scoreDisplayMode?: string;
  title?: string;
  displayValue?: string;
  numericValue?: number;
}

interface ReportCategory {
  score?: number | null;
  auditRefs?: { id: string }[];
}

interface Report {
  lighthouseVersion?: string;
  audits?: Record<string, ReportAudit>;
  categories?: Record<string, ReportCategory>;
}

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

function baseArgs(url: string, outBase: string, viewport: Viewport): string[] {
  const chromeFlags = [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    ...(process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
  ].join(" ");
  return [
    LIGHTHOUSE_CLI,
    url,
    "--output=json",
    "--output=html",
    `--output-path=${outBase}`,
    `--only-categories=${CATEGORIES.join(",")}`,
    "--preset=desktop",
    "--form-factor=desktop",
    `--screenEmulation.width=${viewport.width}`,
    `--screenEmulation.height=${viewport.height}`,
    "--screenEmulation.deviceScaleFactor=1",
    "--screenEmulation.mobile=false",
    `--chrome-flags=${chromeFlags}`,
    "--max-wait-for-load=60000",
    "--quiet",
    "--no-enable-error-reporting",
  ];
}

function runProcess(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

function parseReport(report: Report): Omit<AuditResult, "error"> {
  const scores = Object.fromEntries(
    CATEGORIES.map((category) => [category, report.categories?.[category]?.score ?? null]),
  ) as Record<Category, number | null>;

  const metrics: Record<string, number | null> = {};
  for (const id of METRIC_IDS) {
    const value = report.audits?.[id]?.numericValue;
    metrics[id] = typeof value === "number" ? value : null;
  }

  const failures: AuditFailure[] = [];
  for (const category of CATEGORIES) {
    for (const ref of report.categories?.[category]?.auditRefs ?? []) {
      const audit = report.audits?.[ref.id];
      if (!audit || audit.score == null || audit.score >= 1) continue;
      if (NON_GRADED.has(audit.scoreDisplayMode ?? "")) continue;
      failures.push({
        id: ref.id,
        title: audit.title ?? ref.id,
        category,
        score: audit.score,
        displayValue: audit.displayValue ?? null,
      });
    }
  }

  return { lighthouseVersion: report.lighthouseVersion ?? null, scores, metrics, failures };
}

function emptyResult(error: string): AuditResult {
  const scores = Object.fromEntries(CATEGORIES.map((category) => [category, null])) as Record<
    Category,
    number | null
  >;
  return { lighthouseVersion: null, scores, metrics: {}, failures: [], error };
}

/**
 * Run one audit into `outBase` (`<outBase>.report.json` / `.report.html`).
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

  const { code, stderr } = await runProcess(baseArgs(url, outBase, viewport), timeoutMs);
  if (code !== 0) return emptyResult(stderr.trim() || `lighthouse exited ${code}`);

  try {
    const report = JSON.parse(await readFile(`${outBase}.report.json`, "utf8")) as Report;
    return { ...parseReport(report), error: null };
  } catch (err) {
    return emptyResult(`could not read the report: ${String(err)}`);
  }
}
