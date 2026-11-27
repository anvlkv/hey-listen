#!/usr/bin/env node
/**
 * Copy the screenshots the manual uses into the landing's `public/` tree.
 *
 * The manual is the source of truth and lives at `docs/manual/`; the landing is a
 * separate Astro project, so its Markdown-relative `assets/…` paths need one fixed
 * URL prefix (`/manual-assets/`). Copying at build time keeps a single copy of the
 * images in the repository. `public/manual-assets/` is git-ignored.
 *
 * The analyzer panels, the whole-workbench shot, the export surfaces and the source
 * rails are **captured** from the running app into `public/images/` by
 * `npm run capture:landing`; they are committed and are not part of this sync.
 */

import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANDING = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(LANDING, "..");
const DEST = path.join(LANDING, "public", "manual-assets");

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });

const manualAssets = path.join(ROOT, "docs", "manual", "assets");
const files = await readdir(manualAssets);
for (const file of files) {
  if (!file.endsWith(".png")) continue;
  await copyFile(path.join(manualAssets, file), path.join(DEST, file));
}

console.log(`landing: copied ${files.length} manual screenshots`);
