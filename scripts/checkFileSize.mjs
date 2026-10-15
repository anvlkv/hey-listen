#!/usr/bin/env node
/**
 * File-length budget — the "keep files consumable" rule of the maid.
 *
 * A source file may not grow past `CEILING` lines. The files that are already
 * over it are pinned in `scripts/maid-baseline/fileSizes.json` at their current
 * length, so this check fails on *growth* and on any *new* over-long file — while
 * the existing backlog is split up over time (see `docs/code-hygiene.md`).
 *
 *   node scripts/checkFileSize.mjs             # check (used by CI + pre-push)
 *   node scripts/checkFileSize.mjs --init      # one-time: snapshot the backlog
 *   node scripts/checkFileSize.mjs --update    # ratchet: re-snapshot, never raise
 *
 * `--update` drops entries for files that are now within the ceiling and lowers
 * the rest to their current size. It deliberately refuses to *raise* a budget: a
 * file that grew is a failure, not a new number. Passing the tests is not a
 * reason for a file to get longer.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "maid-baseline", "fileSizes.json");

/** Hard ceiling, in lines, for a hand-written source file. */
const CEILING = 400;

/** Only source files count; docs (`*.md`) are prose and may be long on purpose. */
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".rs", ".mjs", ".js"]);

/** Pruned wholesale: build output, caches, vendored assets, generated trees. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".npm-cache",
  "dist",
  "site",
  "logs",
  "target",
  "gen",
  "artifacts",
  ".fixtures",
  "public",
]);

/** Pruned by path: ts-rs writes these from the Rust types (`cargo test`). */
const SKIP_PATHS = [join("src", "bindings")];

function countLines(text) {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return text.endsWith("\n") ? lines : lines + 1;
}

/** Every source file under `ROOT`, with its line count, as repo-relative POSIX paths. */
function collect() {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      const rel = relative(ROOT, full);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (SKIP_PATHS.some((skip) => rel === skip || rel.startsWith(skip + sep))) continue;
        visit(full);
      } else if (EXTENSIONS.has(extname(entry.name))) {
        files.push({
          path: rel.split(sep).join("/"),
          lines: countLines(readFileSync(full, "utf8")),
        });
      }
    }
  };
  visit(ROOT);
  return files.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeBaseline(budget) {
  const sorted = Object.fromEntries(Object.entries(budget).sort(([a], [b]) => a.localeCompare(b)));
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

function main() {
  const mode = process.argv.includes("--init")
    ? "init"
    : process.argv.includes("--update")
      ? "update"
      : "check";

  const files = collect();
  const over = files.filter((file) => file.lines > CEILING);
  const budget = readBaseline();

  if (mode === "init" || mode === "update") {
    const raised =
      mode === "update"
        ? over.filter((file) => budget[file.path] != null && file.lines > budget[file.path])
        : [];
    if (raised.length > 0) {
      console.error("Refusing to raise a budget — these files grew and must be split:\n");
      for (const file of raised) {
        console.error(`  ${file.path}: ${budget[file.path]} → ${file.lines} lines`);
      }
      console.error("");
      process.exit(1);
    }
    const next = {};
    for (const file of over) next[file.path] = file.lines;
    writeBaseline(next);
    const removed = Object.keys(budget).filter((path) => next[path] == null && budget[path] > 0);
    console.log(
      `fileSizes: budget ${mode === "init" ? "initialised" : "updated"} — ` +
        `${over.length} file(s) over ${CEILING} lines pinned` +
        (removed.length > 0
          ? `, ${removed.length} entry(ies) dropped (now within the ceiling)`
          : "") +
        `.\n  ${relative(ROOT, BASELINE_PATH)}`,
    );
    return;
  }

  const failures = [];
  for (const file of over) {
    const allowed = budget[file.path];
    if (allowed == null) {
      failures.push(
        `${file.path} is ${file.lines} lines and is not in the budget (new over-long file)`,
      );
    } else if (file.lines > allowed) {
      failures.push(`${file.path} grew to ${file.lines} lines (budget ${allowed})`);
    }
  }

  const stale = Object.keys(budget).filter((path) => !over.some((file) => file.path === path));
  const overBudget = over.filter((file) => budget[file.path] != null);
  const largest = files.slice(0, 5).map((file) => `${file.path} (${file.lines})`);

  if (failures.length > 0) {
    console.error(
      `\n✖ fileSizes: ${failures.length} problem(s) with the ${CEILING}-line ceiling.\n`,
    );
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      "\n  Split the file into focused modules (see docs/code-hygiene.md) — the ceiling is not\n" +
        "  negotiable, which is why the budget can only ratchet down.",
    );
    console.error("");
    process.exit(1);
  }

  console.log(
    `✔ fileSizes: no file past its budget ` +
      `(${overBudget.length} budgeted, ${over.length} over the ${CEILING}-line ceiling).`,
  );
  if (largest.length > 0) console.log(`  largest: ${largest.join(", ")}`);
  if (stale.length > 0) {
    console.log(
      `  ${stale.length} budget entry(ies) are now within the ceiling — ` +
        `run \`npm run maid:size -- --update\` to drop them:\n    ${stale.join("\n    ")}`,
    );
  }
}

main();
