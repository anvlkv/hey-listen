#!/usr/bin/env node
/**
 * Build the manual into the app's bundled `public/help/` tree.
 *
 * The in-app **Help → Hey Listen Manual** window serves these pages from inside the
 * app bundle: the same chapters the published docs show, with docs-only chrome, so the
 * manual works offline and never leaves the app. `LANDING_HELP=1` switches the landing
 * build to the `/help` base and its own output directory; this script then copies only
 * the manual, its screenshots and the compiled CSS into `<root>/public/help`, which
 * Vite serves in `npm run dev` and copies into `dist/` in `npm run build`.
 *
 * `--if-needed` skips the build when the output is newer than every input, so a dev
 * start only pays for it after a manual or docs-layout change.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANDING = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(LANDING, "..");
const OUT_DIR = path.join(LANDING, "help-dist");
const DEST = path.join(ROOT, "public", "help");
const ENTRY = path.join(DEST, "docs", "index.html");

/** The trees whose edits make the bundled copy stale (`docs/manual` is the source). */
const INPUTS = [
  path.join(ROOT, "docs", "manual"),
  path.join(LANDING, "src"),
  path.join(LANDING, "astro.config.mjs"),
];

/** Newest modification time under `target`, files only: a folder's own mtime misses edits. */
function newest(target) {
  const stat = statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let latest = stat.mtimeMs;
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    latest = Math.max(latest, newest(path.join(target, entry.name)));
  }
  return latest;
}

function stale() {
  if (!existsSync(ENTRY)) return true;
  const built = statSync(ENTRY).mtimeMs;
  return INPUTS.some((input) => newest(input) > built);
}

if (process.argv.includes("--if-needed") && !stale()) {
  console.log("help: bundled manual is up to date");
  process.exit(0);
}

/** Run one of this workspace's node scripts, inheriting the npm-provided PATH. */
function run(script, args = [], env = {}) {
  const result = spawnSync(process.execPath, [path.join(LANDING, "scripts", script), ...args], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    console.error(`help: ${script} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The docs' screenshots live in `docs/manual/assets`; the landing serves them from
// `public/manual-assets`, which the sync step refreshes.
run("sync-assets.mjs");
run("astro.mjs", ["build"], { LANDING_HELP: "1", PUBLIC_HELP: "1" });

// Only the manual, its screenshots and the assets those pages reference enter the app
// bundle — the landing's own pages, screenshots and hero film stay out of it.
rmSync(DEST, { recursive: true, force: true });
mkdirSync(path.join(DEST, "_astro"), { recursive: true });
cpSync(path.join(OUT_DIR, "docs"), path.join(DEST, "docs"), { recursive: true });
cpSync(path.join(OUT_DIR, "manual-assets"), path.join(DEST, "manual-assets"), {
  recursive: true,
});

// The help build also renders the landing's pages, so `_astro/` holds assets (and
// hashed screenshots) the manual never asks for. Copy the ones the chapters link.
const assets = new Set();
const collect = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (entry.name.endsWith(".html")) {
      const html = readFileSync(full, "utf8");
      for (const match of html.matchAll(/\/help\/_astro\/([^"'?#)\s]+)/g)) assets.add(match[1]);
    }
  }
};
collect(path.join(DEST, "docs"));
if (assets.size === 0) {
  console.error("help: the built chapters reference no assets — the build is broken");
  process.exit(1);
}
for (const asset of assets) {
  cpSync(path.join(OUT_DIR, "_astro", asset), path.join(DEST, "_astro", asset));
}

console.log(`help: wrote ${path.relative(ROOT, DEST)}/ from docs/manual`);
