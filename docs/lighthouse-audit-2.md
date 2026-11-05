# Lighthouse audit 2 (M32.A)

The second pass, after the improvement work the first audit scoped. It uses the same
harness and matrix as [`lighthouse-audit-1.md`](lighthouse-audit-1.md) (66 runs: 36
full-category, 30 `color-contrast`; see that doc's **Profiles** and **Reproduce**
sections rather than duplicating them here). This document records what changed, the
new scores, and what is deliberately left.

- **Date:** 2026-11-04
- **Lighthouse:** 13.6.0 via the Node API (`lighthouse` + `chrome-launcher`), desktop
  config, headless Chrome
- **Budgets:** `scripts/lighthouse/budgets.json` now `{ performance: 0.95,
  accessibility: 1, best-practices: 1, seo: 1, contrast: 1 }`; `npm run lighthouse --
  --check` passes every run.

## Headline

| Scope | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| Audit 1 (36 full runs) | 89.9 / 81 | 86.5 / 82 | 96.0 / 96 | 90.0 / 90 |
| **Audit 2 (36 full runs)** | **98.4 / 97** | **100 / 100** | **100 / 100** | **100 / 100** |
| Audit 1 theme sweep | 0/30 contrast passes | — | — | — |
| **Audit 2 theme sweep** | **30/30 contrast passes (0 failing nodes)** | — | — | — |

Per-surface performance is now 97–100 (small / large):

| Surface | Performance | All other categories |
| --- | --- | --- |
| empty / source / annotations | 99 / 99 | 100 |
| waveform / levels / frameRms / spectrogram / modulation | 98–99 / 98 | 100 |
| spectrum / melSpectrogram / noteMetrics / tempo | 97–99 / 97–98 | 100 |
| filter / synth | 99 / 97–99 | 100 |
| compare / compareSeries | 98–99 / 98–99 | 100 |
| popout / about | 99–100 / 99–100 | 100 |

## What was fixed

Each item names the owner file so the change is auditable.

### A1 — Contrast tokens (every theme)

The secondary text ramp was raised so `--fg-muted`, `--fg-dim` and `--fg-faint` clear
**4.5:1 against both `--panel-2` and `--panel-3`** in all six palettes:
`src/styles/base.css` (dark + light) and the `ui` overlays in
`src/state/themes/builtinNord.ts`, `builtinRetrowave.ts`, `builtinSolarized.ts`.
`.sidebar-subtitle` now uses `--fg-muted` instead of `--fg-disabled`
(`src/styles/params.css`), and `--fg-disabled` is reserved for disabled controls.
The About dialog no longer uses the faint ramp at all.

A new unit check, `scripts/themeContrast.test.ts`, merges each built-in overlay over
its base and asserts the three tokens on both panels; it runs in `npm run test:unit`.

### A2 — Slider accessible names

`aria-label` now reaches the generated thumb (and the hidden input) of every Kobalte
slider: preview output gain (`src/components/Toolbar.tsx`), timeline preview speed
(`src/components/timeline/TimelineToolbar.tsx`), and live input gain
(`src/components/source/LiveControls.tsx`). `aria-input-field-name` is green.

### A3 — Main landmark

`src/App.tsx`'s primary region is `<main class="app-main">`, so
`landmark-one-main` passes without changing the layout.

### A4 / A5 — Targets and names

Annotation action buttons are 24 px (`src/styles/annotations.css`); the About dialog no
longer renders a list of sub-24 px dependency links. The graph palette toggle's
accessible name includes its visible "Nodes" text
(`src/components/graphEditor/GraphPalette.tsx`). `target-size` and
`label-content-name-mismatch` are green.

### B1 / B2 / C1 — Console, favicon, description

- The spurious `[startup] the popout query did not answer…` is gone: a project window
  no longer waits for (or logs about) the popout query, and the popout timeout is
  cleared once the query settles (`src/index.tsx`).
- `public/icon.png` is the favicon for `index.html` and `preview.html`; the dead
  `/tauri.svg` request is gone.
- Both pages carry a `<meta name="description">`.
  `errors-in-console` and `meta-description` are green.

### About dialog (same change)

`src/components/AboutDialog.tsx` keeps the one **required** attribution (Font Awesome)
and links to `ACKNOWLEDGEMENTS.md`, instead of listing every runtime dependency. This
removed the small-link target-size failures and the faint-text contrast failures.

### P1 — The analyzer/compare performance gap

Audit 1 measured LCP on the analyzer empty-state hint painted while the first result
computed (~750–900 ms of element render delay). The first-load busy state in
`src/components/analyzer/AnalyzerTab.tsx` now keeps the chart/empty-state children
**unmounted until a result exists**, so the late-painted hint is no longer the LCP
element; LCP is now the shell, painted with FCP. The analyzer and compare surfaces went
from 81–89 to 97–99.

What remains below a 1.0 weighted audit is only `speed-index` (weight 10) and
`total-blocking-time` (weight 30), both near-passing; the per-surface minimum is 0.97.

## Deliberately not fixed

- **`cache-insight`, `document-latency-insight`** — not applicable to a local static
  server / desktop app, as [audit 1](lighthouse-audit-1.md#p1--analyzer-tabs-and-compare-lcp-is-the-performance-gap)
  explains. Do not optimize the app for them.
- **`valid-source-maps`** (weight 0) — the `.lighthouse/site` preview build ships no
  source maps; the shipped app is read from disk, not fetched. Informational only.
- **`unused-javascript` / `unused-css-rules` / `render-blocking-insight` /
  `forced-reflow-insight` / `network-dependency-tree-insight`** (weight 0 in this
  Lighthouse version) — the preview entry still includes the 444 kB analysis fixture;
  that is a harness cost, not the app's. Deferring Workbench vendors is no longer needed
  to hit the budget.
- **`font-display-insight`** (weight 0) — the bundled font is local; the app does not
  fetch a webfont over the network.

## Coverage

The matrix is unchanged: every `PREVIEW_SURFACES` id × both laptop viewports for the
full categories, and every built-in theme × the five theme-token surfaces for contrast
— see [audit 1](lighthouse-audit-1.md) for the exact lists and the commands. The raw
report is generated (not committed) under `reports/lighthouse/` and served with
`npm run lighthouse:serve`.
