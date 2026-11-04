/**
 * Aggregate the per-run Lighthouse reports into `summary.json` and a browsable
 * `index.html`. The HTML is the report's entry point (serve it with
 * `npm run lighthouse:serve`); each row links to the untouched Lighthouse report.
 *
 * The index is a **navigator**, not a reimplementation of the report UI: every
 * per-run HTML is rendered by Lighthouse's own `ReportGenerator`. Lighthouse has no
 * multi-URL report, so this page is the only thing that puts the full matrix in one
 * place. Full-category aggregates and the `color-contrast` sweep are kept separate —
 * their scores are not comparable.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { AuditFailure, ContrastResult } from "./audit";
import { CATEGORIES, REPORT_DIR, THEMES, type Category, type Profile } from "./config";
import type { SurfaceKind } from "../../src/preview/surfaces";

/** One audited surface × theme × viewport. */
export interface RunSummary {
  profile: Profile;
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
  /** The `color-contrast` audit's result (present for both profiles). */
  contrast: ContrastResult | null;
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

/** The theme sweep's one-number-per-theme result. */
export interface VisualThemeSummary {
  theme: string;
  runs: number;
  failingRuns: number;
  maxFailingNodes: number;
  worstRatio: number | null;
}

export interface Summary {
  generatedAt: string;
  lighthouseVersion: string | null;
  runs: RunSummary[];
  full: {
    runs: number;
    aggregates: {
      overall: Record<Category, Aggregate>;
      byViewport: Record<string, Record<Category, Aggregate>>;
      bySurface: Record<string, Record<Category, Aggregate>>;
    };
  };
  visual: {
    runs: number;
    failingRuns: number;
    byTheme: VisualThemeSummary[];
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

/** Whether a run's contrast sweep found a failure (an error counts separately). */
function contrastFails(run: RunSummary): boolean {
  return (run.contrast?.failingNodes ?? 0) > 0 || run.contrast?.score === 0;
}

function visualSummary(runs: RunSummary[]): Summary["visual"] {
  const byTheme = THEMES.map((theme): VisualThemeSummary => {
    const themeRuns = runs.filter((run) => run.theme === theme);
    const nodes = themeRuns.map((run) => run.contrast?.failingNodes ?? 0);
    const ratios = themeRuns
      .map((run) => run.contrast?.worstRatio)
      .filter((ratio): ratio is number => ratio != null);
    return {
      theme,
      runs: themeRuns.length,
      failingRuns: themeRuns.filter(contrastFails).length,
      maxFailingNodes: themeRuns.length === 0 ? 0 : Math.max(...nodes),
      worstRatio: ratios.length === 0 ? null : Math.min(...ratios),
    };
  }).filter((theme) => theme.runs > 0);

  return { runs: runs.length, failingRuns: runs.filter(contrastFails).length, byTheme };
}

/** Build the aggregate summary (persisted next to the reports). */
export function buildSummary(runs: RunSummary[], lighthouseVersion: string | null): Summary {
  const fullRuns = runs.filter((run) => run.profile === "full");
  const visualRuns = runs.filter((run) => run.profile === "visual");
  return {
    generatedAt: new Date().toISOString(),
    lighthouseVersion,
    runs,
    full: {
      runs: fullRuns.length,
      aggregates: {
        overall: aggregateGroup(fullRuns),
        byViewport: Object.fromEntries(
          Object.entries(groupBy(fullRuns, (run) => run.viewport)).map(([key, group]) => [
            key,
            aggregateGroup(group),
          ]),
        ),
        bySurface: Object.fromEntries(
          Object.entries(groupBy(fullRuns, (run) => run.surface)).map(([key, group]) => [
            key,
            aggregateGroup(group),
          ]),
        ),
      },
    },
    visual: visualSummary(visualRuns),
    auditFailures: auditFailureSummary(fullRuns),
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

function contrastCell(contrast: ContrastResult | null): string {
  if (!contrast) return `<td class="num">–</td>`;
  const label = scoreText(contrast.score);
  const nodes = contrast.failingNodes > 0 ? ` <small>(${contrast.failingNodes})</small>` : "";
  return `<td class="num ${scoreClass(contrast.score)}">${label}${nodes}</td>`;
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
  const overall = aggregateRow("All full runs", summary.full.aggregates.overall);
  const viewportRows = Object.entries(summary.full.aggregates.byViewport)
    .map(([key, value]) => aggregateRow(`Viewport ${key}`, value))
    .join("\n");
  const surfaceRows = Object.entries(summary.full.aggregates.bySurface)
    .map(([key, value]) => aggregateRow(key, value))
    .join("\n");

  const visualRows =
    summary.visual.byTheme.length === 0
      ? `<tr><td colspan="5" class="empty">No color sweep was run.</td></tr>`
      : summary.visual.byTheme
          .map((theme) => {
            const status = theme.failingRuns === 0 ? "s-good" : "s-bad";
            return (
              `<tr><td>${esc(theme.theme)}</td><td class="num">${theme.runs}</td>` +
              `<td class="num ${status}">${theme.failingRuns}</td>` +
              `<td class="num">${theme.maxFailingNodes}</td>` +
              `<td class="num">${theme.worstRatio == null ? "–" : theme.worstRatio.toFixed(2)}</td></tr>`
            );
          })
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
        `<tr><td>${esc(run.profile)}</td><td>${esc(run.surface)}</td><td>${esc(run.title)}</td>` +
        `<td>${esc(run.theme)}</td><td>${esc(run.viewport)}</td>${cells}` +
        `${contrastCell(run.contrast)}<td>${report}</td></tr>`
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
<p>${esc(summary.generatedAt)} · ${summary.full.runs} full runs + ${summary.visual.runs} color runs ·
Lighthouse ${esc(summary.lighthouseVersion ?? "unknown")} · scores are out of 100 (mean / worst per group)</p>
<p>Each <strong>report</strong> link opens Lighthouse's own standalone HTML report (the official
<code>ReportGenerator</code> renderer). This page only aggregates the per-run LHRs — Lighthouse has
no multi-URL report, so this is the navigator over the individual reports.</p>

<h2>Full-category runs (baseline theme)</h2>
<table>
<thead><tr><th>Scope</th>${CATEGORIES.map((category) => `<th class="num">${esc(category)}</th>`).join("")}</tr></thead>
<tbody>
${overall}
${viewportRows}
${surfaceRows}
</tbody>
</table>

<h2>Theme contrast sweep</h2>
<p>Only <code>color-contrast</code> is run for every theme (one viewport; the surfaces cover the
theme-token consumers). Contrast is a binary audit, so “failing runs” is the useful number,
not a category score.</p>
<table>
<thead><tr><th>Theme</th><th class="num">Runs</th><th class="num">Failing</th><th class="num">Max nodes</th><th class="num">Worst ratio</th></tr></thead>
<tbody>${visualRows}</tbody>
</table>

<h2>Failing audits (full runs)</h2>
<table>
<thead><tr><th>Audit</th><th>Category</th><th class="num">Runs</th><th class="num">Worst</th><th>Surfaces</th></tr></thead>
<tbody>${failureRows}</tbody>
</table>

<h2>Every run</h2>
<div class="scroll">
<table>
<thead><tr><th>Profile</th><th>Surface</th><th>Title</th><th>Theme</th><th>Viewport</th>${CATEGORIES.map((category) => `<th class="num">${esc(category)}</th>`).join("")}<th class="num">Contrast</th><th>Detail</th></tr></thead>
<tbody>${runRows}</tbody>
</table>
</div>
</body>
</html>
`;
}
