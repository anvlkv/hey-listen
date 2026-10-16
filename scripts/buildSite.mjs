#!/usr/bin/env node
/**
 * Generate the site's documentation subpages from the repo's markdown sources:
 *   - `site/acknowledgements.html`  ←  `ACKNOWLEDGEMENTS.md`
 *   - `site/roadmap.html`           ←  `docs/roadmap.md` (milestone titles + status)
 *
 * and stamp the release version (from `package.json`) into the hand-authored page: the
 * download button in `site/index.html` and its mirror in `site/copy.json`.
 *
 * Run in the deploy workflow (before publishing `site/`) and locally via
 * `npm run build:site`. Pure Node, no dependencies. The generated pages share the
 * main site's stylesheet and header/footer.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE = path.join(ROOT, "site");

const REPO = "https://github.com/anvlkv/hey-listen";
const PROFILE = "https://github.com/anvlkv";

// --- a tiny markdown → HTML (only the subset the docs use) ------------------

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Strip emoji (the site's tone is plain/ASCII). The variation selector (`\u{FE0F}`) is
 * a combining mark, so it cannot sit in the character class with the ranges — it is
 * stripped as a separate alternative.
 */
const deEmoji = (s) =>
  s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}]|\u{FE0F}/gu, "").trimEnd();

/** Inline spans: links, bold, italic, inline code (escape first). */
function inline(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
      const ext = /^https?:/.test(href);
      return `<a href="${href}"${ext ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Headings, paragraphs, and `-`/`*` lists — enough for the acknowledgements. */
function markdownToHtml(md) {
  const out = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${inline(deEmoji(heading[2]))}</h${heading[1].length}>`);
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(deEmoji(item[1]))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(deEmoji(line))}</p>`);
  }
  closeList();
  return out.join("\n");
}

// --- roadmap milestones -----------------------------------------------------

/** The `## Mx — Title ✅` / `## Mx — Title (planned)` headers, with status. */
function roadmapMilestones(md) {
  const items = [];
  for (const line of md.split("\n")) {
    const match = /^##\s+((?:M\d+(?:\.\w+)?|Backlog)\b.*)$/.exec(line.trim());
    if (!match) continue;
    const raw = match[1].trim();
    const done = raw.includes("✅");
    const title = raw
      .replace(/✅/g, " ")
      .replace(/\((?:planned|delivered)\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    items.push({ title, done });
  }
  return items;
}

function timelineHtml(items) {
  const rows = items.map(
    ({ title, done }) => `        <li class="milestone ${done ? "is-done" : "is-pending"}">
          <span class="milestone-mark" aria-hidden="true">${done ? "&#10003;" : ""}</span>
          <span class="milestone-title">${inline(title)}</span>
          <span class="milestone-status">${done ? "done" : "planned"}</span>
        </li>`,
  );
  return `      <ol class="timeline">\n${rows.join("\n")}\n      </ol>`;
}

// --- the shared page shell --------------------------------------------------

const GITHUB_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

function page({ title, description, content }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="theme-color" content="#0a0b0f" />
    <link rel="icon" href="assets/icon.png" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="site-header">
      <div class="container header-inner">
        <a class="brand" href="index.html">
          <img class="mark" src="assets/icon.png" alt="" width="36" height="36" />
          <span class="wordmark">Hey Listen</span>
        </a>
        <a class="repo-link" href="${REPO}" target="_blank" rel="noopener">
          ${GITHUB_ICON}
          <span>GitHub</span>
        </a>
      </div>
    </header>

    <main class="doc container">
      ${content}
    </main>

    <footer class="site-footer">
      <div class="container">
        <nav class="footer-nav">
          <a href="index.html">Home</a>
          <a href="roadmap.html">Roadmap</a>
          <a href="acknowledgements.html">Acknowledgements</a>
          <a href="${REPO}" target="_blank" rel="noopener">GitHub</a>
        </nav>
        <p class="oss">
          Proudly open source - released under the Unlicense, so it's yours to use,
          change, and share.
        </p>
        <p class="author">
          Made by <a href="${PROFILE}" target="_blank" rel="noopener">a.nvlkv</a>
        </p>
      </div>
    </footer>
  </body>
</html>
`;
}

// --- build ------------------------------------------------------------------

const acknowledgements = await readFile(path.join(ROOT, "ACKNOWLEDGEMENTS.md"), "utf8");
const roadmap = await readFile(path.join(ROOT, "docs", "roadmap.md"), "utf8");

const ackHtml = markdownToHtml(acknowledgements);
// The source's own `# Acknowledgements` heading becomes the page title; drop the
// now-duplicated H1 in favour of the page's own heading block.
const ackBody = ackHtml.replace(/^<h1>[^<]*<\/h1>\s*/, "");

await writeFile(
  path.join(SITE, "acknowledgements.html"),
  page({
    title: "Acknowledgements - Hey Listen",
    description: "The open-source maintainers whose work Hey Listen is built on.",
    content: `      <h1 class="doc-title">Acknowledgements</h1>
      <div class="prose">
${ackBody}
      </div>`,
  }),
);

const milestones = roadmapMilestones(roadmap);
const done = milestones.filter((m) => m.done).length;

await writeFile(
  path.join(SITE, "roadmap.html"),
  page({
    title: "Roadmap - Hey Listen",
    description: "Where Hey Listen has been and where it is going.",
    content: `      <h1 class="doc-title">Roadmap</h1>
      <p class="doc-lede">${done} of ${milestones.length} milestones shipped.</p>
${timelineHtml(milestones)}`,
  }),
);

// --- version stamp -----------------------------------------------------------

/**
 * Stamp the release version into a hand-authored file.
 *
 * `site/` has no build step of its own, so the download button's version would drift
 * from the `package.json` the release process bumps. Stamping it here — the deploy runs
 * this script before uploading — keeps the *published* page honest, while the checked-in
 * file keeps the last published version (which is what a local preview should show,
 * since `serve:site` does not stamp).
 *
 * A missing anchor is an error on purpose: silently skipping the stamp is exactly how a
 * version goes stale without anyone noticing.
 */
async function stampVersion(file, pattern, value) {
  const before = await readFile(file, "utf8");
  if (!pattern.test(before)) {
    throw new Error(`no version anchor (${pattern}) in ${path.relative(ROOT, file)}`);
  }
  const after = before.replace(pattern, value);
  if (after === before) return false;
  await writeFile(file, after);
  return true;
}

const { version } = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

const stamped = [
  await stampVersion(
    path.join(SITE, "index.html"),
    /(<span class="button-version">v)[^<]*(<\/span>)/,
    `$1${version}$2`,
  ),
  await stampVersion(
    path.join(SITE, "copy.json"),
    /("downloadVersion"\s*:\s*")[^"]*(")/,
    `$1${version}$2`,
  ),
];

console.log(`site: wrote acknowledgements.html + roadmap.html (${milestones.length} milestones)`);
console.log(
  `site: version v${version}` +
    (stamped.some(Boolean) ? " stamped into index.html + copy.json" : " (already current)"),
);
