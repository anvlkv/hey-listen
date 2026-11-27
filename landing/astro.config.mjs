import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";
import solid from "@astrojs/solid-js";

import { rehypeDocs } from "./src/lib/rehype-docs.mjs";

const REPO = "https://github.com/anvlkv/hey-listen";

const manualDir = fileURLToPath(new URL("../docs/manual", import.meta.url));
const chapters = readdirSync(manualDir)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .map((file) => file.replace(/\.md$/, ""));

/**
 * Two builds share this source:
 *
 * - the published landing (`npm run build:landing`), served from GitHub Pages under
 *   `/hey-listen/`;
 * - the in-app manual (`npm run help`): the same docs pages with docs-only chrome,
 *   rooted at `/help/` and copied into the app bundle. `PUBLIC_HELP` is the flag the
 *   layouts (and nothing else) read.
 */
const help = process.env.LANDING_HELP === "1";

/**
 * GitHub Pages serves a project site under `/<repo>/`. Astro's `base` makes the Vite
 * asset URLs match; the rehype plugin receives the same value so links inside the
 * manual point at the same root too. The help build is served by the app's asset
 * protocol, which mounts the frontend at `/`, so its tree lives under `/help/`.
 */
const base = help ? "/help" : "/hey-listen";

export default defineConfig({
  site: "https://anvlkv.github.io",
  base,
  // The help build must not overwrite the landing the preview server serves.
  outDir: help ? "help-dist" : "dist",
  output: "static",
  compressHTML: true,
  integrations: [solid()],
  markdown: {
    // Astro 7 defaults to Sätteri. The manual needs the unified pipeline so relative
    // chapter links and screenshot paths can be rewritten for the deployed site.
    processor: unified({
      rehypePlugins: [[rehypeDocs, { base, repo: REPO, chapters }]],
    }),
    shikiConfig: { theme: "github-dark" },
  },
});
