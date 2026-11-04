/**
 * Aggregate the per-run Lighthouse reports into `summary.json` and a browsable
 * `index.html`. The HTML is the report's entry point (serve it with
 * `npm run lighthouse:serve`); each row links to the untouched Lighthouse report.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { AuditFailure } from "./audit";
import { CATEGORIES, REPORT_DIR, type Category } from "./config";
import type { SurfaceKind } from "../../src/preview/surfaces";

/** One audited surface × theme × viewport. */
export interface RunSummary {
  surface: string;
  title: string;
  kind: SurfaceKind;
  theme: string;
  viewport: string;
  url: string;
  reportJson: string;
  reportHtml: string;
  scores: Record<Category, number | null>;
  metrics: Record<string, number | null>;
  failures: AuditFailure[];
  error: string | null;
}

export interface Aggregate {
  mean: number | null;
  min: number | null;
}

export interface AuditFailureSummary {
  id: string;
  title: string;
  category: Category;
  runs: number;
  worst: number;
  surfaces: string[];
}

export interface Summary {
  generatedAt: string;
  lighthouseVersion: string | null;
  runs: RunSummary[];
  aggregates: {
    overall: Record<Category, Aggregate>;
    byViewport: Record<string, Record<Category, Aggregate>>;
    byTheme: Record<string, Record<Category, Aggregate>>;
  };
  auditFailures: AuditFailureSummary[];
}

function aggregate(values: number[]): Aggregate {
  if (values.length === 0) return { mean: null, min: null };
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    min: Math.min(...values),
  };
}

function scoresFor(runs: RunSummary[], category: Category): number[] {
  return runs.map((run) => run.scores[category]).filter((score): score is number => score != null);
}

function aggregateGroup(runs: RunSummary[]): Record<Category, Aggregate> {
  return Object.fromEntries(
    CATEGORIES.map((category) => [category, aggregate(scoresFor(runs, category))]),
  ) as Record<Category, Aggregate>;
}

function groupBy(
  runs: RunSummary[],
  key: (run: RunSummary) => string,
): Record<string, RunSummary[]> {
  const groups: Record<string, RunSummary[]> = {};
  for (const run of runs) (groups[key(run)] ??= []).push(run);
  return groups;
}

function auditFailureSummary(runs: RunSummary[]): AuditFailureSummary[] {
  const byAudit = new Map<string, AuditFailureSummary>();
  for (const run of runs) {
    for (const failure of run.failures) {
      const key = `${failure.category}:${failure.id}`;
      const existing = byAudit.get(key);
      if (existing) {
        existing.runs++;
        existing.worst = Math.min(existing.worst, failure.score ?? 0);
        if (!existing.surfaces.includes(run.surface)) existing.surfaces.push(run.surface);
      } else {
        byAudit.set(key, {
          id: failure.id,
          title: failure.title,
          category: failure.category,
          runs: 1,
          worst: failure.score ?? 0,
          surfaces: [run.surface],
        });
      }
    }
  }
  return [...byAudit.values()].sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id));
}

/** Build the aggregate summary (persisted next to the reports). */
export function buildSummary(runs: RunSummary[], lighthouseVersion: string | null): Summary {
  return {
    generatedAt: new Date().toISOString(),
    lighthouseVersion,
    runs,
    aggregates: {
      overall: aggregateGroup(runs),
      byViewport: Object.fromEntries(
        Object.entries(groupBy(runs, (run) => run.viewport)).map(([key, group]) => [
          key,
          aggregateGroup(group),
        ]),
      ),
      byTheme: Object.fromEntries(
        Object.entries(groupBy(runs, (run) => run.theme)).map(([key, group]) => [
          key,
          aggregateGroup(group),
        ]),
      ),
    },
    auditFailures: auditFailureSummary(runs),
  };
}

/** Persist `summary.json` and the `index.html` overview. */
export async function writeReport(summary: Summary) {
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(`${REPORT_DIR}/summary.json`, JSON.stringify(summary, null, 2) + "\n");
  await writeFile(`${REPORT_DIR}/index.html`, renderHtml(summary));
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreClass(score: number | null): string {
  if (score == null) return "s-none";
  if (score >= 0.95) return "s-good";
  if (score >= 0.8) return "s-mid";
  return "s-bad";
}

function scoreText(score: number | null): string {
  return score == null ? "–" : String(Math.round(score * 100));
}

function scoreCell(score: number | null): string {
  return `<td class="num ${scoreClass(score)}">${scoreText(score)}</td>`;
}

function aggregateRow(label: string, aggregate: Record<Category, Aggregate>): string {
  const cells = CATEGORIES.map((category) => {
    const { mean, min } = aggregate[category];
    if (mean == null) return `<td class="num">–</td>`;
    return `<td class="num ${scoreClass(mean)}" title="mean ${scoreText(mean)} · min ${scoreText(min)}">${scoreText(mean)}<small> / ${scoreText(min)}</small></td>`;
  }).join("");
  return `<tr><th>${esc(label)}</th>${cells}</tr>`;
}

function renderHtml(summary: Summary): string {
  const overall = aggregateRow("All runs", summary.aggregates.overall);
  const viewportRows = Object.entries(summary.aggregates.byViewport)
    .map(([key, value]) => aggregateRow(`Viewport ${key}`, value))
    .join("\n");
  const themeRows = Object.entries(summary.aggregates.byTheme)
    .map(([key, value]) => aggregateRow(key, value))
    .join("\n");

  const failureRows =
    summary.auditFailures.length === 0
      ? `<tr><td colspan="5" class="empty">No failing audits.</td></tr>`
      : summary.auditFailures
          .map(
            (failure) =>
              `<tr><td><code>${esc(failure.id)}</code></td><td>${esc(failure.category)}</td>` +
              `<td class="num">${failure.runs}</td><td class="num ${scoreClass(failure.worst)}">${scoreText(failure.worst)}</td>` +
              `<td>${esc(failure.surfaces.slice(0, 6).join(", "))}${failure.surfaces.length > 6 ? " …" : ""}</td></tr>`,
          )
          .join("\n");

  const runRows = summary.runs
    .map((run) => {
      const cells = CATEGORIES.map((category) => scoreCell(run.scores[category])).join("");
      const report = run.error
        ? `<span class="s-bad" title="${esc(run.error)}">failed</span>`
        : `<a href="${esc(relative(REPORT_DIR, run.reportHtml))}">report</a>`;
      return (
        `<tr><td>${esc(run.surface)}</td><td>${esc(run.title)}</td><td>${esc(run.theme)}</td>` +
        `<td>${esc(run.viewport)}</td>${cells}<td>${report}</td></tr>`
      );
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hey Listen — Lighthouse audit</title>
<style>
  :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; padding: 32px; background: #0b0d13; color: #e8eaf1; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  h2 { margin: 34px 0 10px; font-size: 16px; color: #b9c0d4; }
  p { margin: 4px 0 18px; color: #9aa3ba; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: #12151f; }
  th, td { padding: 6px 9px; border-bottom: 1px solid #1f2433; text-align: left; vertical-align: top; }
  thead th { position: sticky; top: 0; background: #171b28; color: #c8cee0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td small { color: #6f7891; }
  code { font-size: 12px; color: #c6d0ff; }
  a { color: #7fb4ff; }
  .s-good { color: #6ee7a0; } .s-mid { color: #f4c95d; } .s-bad { color: #ff7a90; } .s-none { color: #6f7891; }
  .empty { color: #6f7891; }
  .scroll { max-height: 70vh; overflow: auto; border: 1px solid #1f2433; }
</style>
</head>
<body>
<h1>Hey Listen — Lighthouse audit</h1>
<p>${esc(summary.generatedAt)} · ${summary.runs.length} runs · Lighthouse ${esc(summary.lighthouseVersion ?? "unknown")} ·
scores are out of 100 (mean / worst per group)</p>

<h2>Aggregates</h2>
<table>
<thead><tr><th>Scope</th>${CATEGORIES.map((category) => `<th class="num">${esc(category)}</th>`).join("")}</tr></thead>
<tbody>
${overall}
${viewportRows}
${themeRows}
</tbody>
</table>

<h2>Failing audits</h2>
<table>
<thead><tr><th>Audit</th><th>Category</th><th class="num">Runs</th><th class="num">Worst</th><th>Surfaces</th></tr></thead>
<tbody>${failureRows}</tbody>
</table>

<h2>Every run</h2>
<div class="scroll">
<table>
<thead><tr><th>Surface</th><th>Title</th><th>Theme</th><th>Viewport</th>${CATEGORIES.map((category) => `<th class="num">${esc(category)}</th>`).join("")}<th>Detail</th></tr></thead>
<tbody>${runRows}</tbody>
</table>
</div>
</body>
</html>
`;
}
