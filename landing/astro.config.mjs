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
 * GitHub Pages serves a project site under `/<repo>/`. Astro's `base` makes the Vite
 * asset URLs match; the rehype plugin receives the same value so links inside the
 * manual point at `/hey-listen/docs/<chapter>/` too.
 */
const base = "/hey-listen";

export default defineConfig({
  site: "https://anvlkv.github.io",
  base,
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
