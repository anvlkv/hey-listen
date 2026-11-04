# Lighthouse audit 1 (M32)

The first automated pass over every surface the app can render. This document is the
durable summary; the raw report is generated (not committed) under
`reports/lighthouse/` and served with `npm run lighthouse:serve`.

- **Date:** 2026-11-04
- **Lighthouse:** 13.6.0, desktop preset, headless Chrome
- **Viewports:** 1280×800 (`small`) and 1920×1080 (`large`), device scale 1
- **Matrix:** 18 surfaces × 6 built-in themes × 2 viewports = **216 runs**
- **Categories:** performance, accessibility, best-practices, SEO
- **Harness:** `npm run lighthouse` (`scripts/lighthouse/run.ts`); surface list in
  `src/preview/surfaces.ts`; themes from `src/state/themes/builtins.ts`
- **Fixtures:** a deterministic 4 s WAV (`src/preview/signal.ts`) and its generated
  analyzer results (`src/preview/fixtures/analysis.json`, keyed by every analyzer in
  `AnalyzerId`), plus the empty state. One representative analyzer per
  `AnalyzerView["kind"]` is audited — the tools share renderers.

## Headline scores

| Scope | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| All 216 runs (mean / min) | **91.7 / 83** | **86.5 / 82** | **96.0 / 96** | **90.0 / 90** |
| small (1280×800) | 91.8 / 85 | 86.5 / 82 | 96.0 / 96 | 90.0 / 90 |
| large (1920×1080) | 91.6 / 83 | 86.5 / 82 | 96.0 / 96 | 90.0 / 90 |

The six themes score identically at the **category** level (an audit is pass/fail, not
a count of failing nodes). The number of contrast failures does vary per theme — see
[A1](#a1--contrast-tokens-fail-in-every-theme).

| Surface | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| empty | 99 | 84 | 96 | 90 |
| source | 99 | 84 | 96 | 90 |
| annotations | 99 | 82 | 96 | 90 |
| waveform / levels / frameRms / spectrum / melSpectrogram / modulation | 87 | 86 | 96 | 90 |
| spectrogram | 86 | 86 | 96 | 90 |
| noteMetrics | 87 | 87 | 96 | 90 |
| tempo | 88 | 86 | 96 | 90 |
| filter / synth | 99 | 87 | 96 | 90 |
| compare / compareSeries | 88 | 86 | 96 | 90 |
| popout | **100** | 94 | 96 | 90 |
| about | 99 | 92 | 96 | 90 |

The performance gap is concentrated in **analyzer tabs** (86–88); the accessibility
gap is app-wide — the toolbar/sidebar/source contrast, the annotations rail (82), and
the analyzer tabs (86–87). The chrome-only states are performance-clean (99–100).

## Findings for M32.B

Ordered by impact on the category scores. Each item names the owner file so the fix
can start without re-reading the report.

### A1 — Contrast tokens fail in every theme

`color-contrast` is a weighted audit (weight 7) and fails on every surface in every
theme. The failures are not one bad element: the secondary/tertiary text tokens are
below 4.5:1 on the panel backgrounds.

| Theme | Failing selectors (union) | Worst ratio | Worst element |
| --- | --- | --- | --- |
| `builtin:dark` | 12 | 3.05 | `.sidebar-subtitle` |
| `builtin:light` | 5 | 2.45 | `.sidebar-subtitle` |
| `builtin:retrowave-neon` | 5 | 2.64 | `.sidebar-subtitle` |
| `builtin:nord` | 17 | 2.19 | `.sidebar-subtitle` |
| `builtin:solarized-dark` | 26 | 2.14 | `.sidebar-subtitle` |
| `builtin:solarized-light` | 22 | 2.04 | `.sidebar-subtitle` |

Recurring culprits and their consumers:

- **`--fg-disabled` is used for readable captions.** `.sidebar-subtitle`
  (`src/styles/params.css:144`) is the worst node in all six themes. A caption is not
  a disabled control; give it `--fg-muted` (or a new caption token) and reserve
  `--fg-disabled` for actual disabled controls. This one change fixes the worst node
  in every theme.
- **`--fg-muted`** fails on `.toolbar-label` (`src/styles/toolbar.css:155`),
  `.sidebar-section-title` (`src/styles/sidebar.css:13`), `.src-hero-hint`
  (`src/styles/source.css:87`), `.annotation-row-meta`
  (`src/styles/annotations.css:158`) and `.note-metrics-table thead th`
  (`src/styles/noteMetrics.css:124`). It is 4.1–4.44 in dark and 3.05–4.16 in the
  Solarized/Nord themes.
- **`--fg-faint`** fails on `.about-link-sm` / `.about-foot`
  (`src/styles/about.css:144`, `:151`) and `.readout-label`
  (`src/styles/analyzer.css:73`). Dark is 3.53; Solarized-light 3.21.
- **`--fg-dim`** fails on `.timeline-filter-state` and `.timeline-speed-value`
  (`src/styles/timeline.css:68`, `:110`): 4.16 in Solarized, 3.91 in Solarized-light.
- **`--accent-2`** link text fails on `.about-link`: 3.05 (solarized-light), 3.79
  (retrowave), 3.20 (nord).
- `.analyzer-title` is 4.16 in solarized-dark.

Fix direction: raise the secondary/tertiary ramp in `src/styles/base.css` (lines
21–55 and 100–134) and in each `ui` overlay (`builtinNord.ts`, `builtinRetrowave.ts`,
`builtinSolarized.ts`), checking the values against **both** `--panel-2` and
`--panel-3`. Target 4.5:1 for normal text (3:1 only for ≥18.66 px bold / ≥24 px).
Because the worst offenders are semantic-token misuse, prefer fixing the consumers
first, then the palette. Consider a unit check in `scripts/themeFile.test.ts` that
computes the ratio for the token pairs the styles use.

### A2 — The output-gain slider has no accessible name

`aria-input-field-name` (weight 7) and `label` (weight 10) fail on every surface that
mounts the toolbar.

- `src/components/Toolbar.tsx:133–146`: `aria-label="Preview output gain"` is passed
  to the Kobalte `Slider` root but not to the generated thumb
  (`span[role="slider"]`) or the hidden range input.
- Add the same `aria-label` to `Slider.Thumb` and `Slider.Input` (or an
  `aria-labelledby` pointing at a visible label), and confirm the audit passes. These
  are the two largest accessibility failures (weights 7 and 10).

### A3 — Missing main landmark

`landmark-one-main` (weight 3) fails everywhere the app shell renders.
`src/App.tsx` wraps the regions in `<div class="app-main">`; there is no `<main>`.
Make the primary region a `<main>` (keep the `app-main` class) or wrap the Workbench +
Timeline in one. The popout shell does not trigger it because it has no other
landmarks; the main window does.

### A4 — Touch targets below 24 px

`target-size` fails on the annotations and About surfaces.

- **Annotation actions** (`src/styles/annotations.css:103`): the three
  `.annotation-icon` buttons are **22×22** with 20 px safe spacing. Raise to at least
  24×24 (the surrounding title bar has room) and keep the spacing.
- **About links** (`src/styles/about.css:144`): `.about-link-sm` is ~15.4 px tall
  (inline text). Give the button block padding / `min-height: 24px` (or increase the
  line box) so the target is 24 px; the audit also asks for spacing, so prefer a small
  vertical margin.

### A5 — Palette toggle's accessible name omits its visible text

`label-content-name-mismatch` (weight 0, but a correctness flag) fires on both graph
editors. `src/components/graphEditor/GraphPalette.tsx:146` sets
`aria-label="Expand/Collapse node palette"` while the button visibly says **Nodes**.
Include the visible text: e.g. `Nodes — collapse palette` / `Nodes — expand palette`,
or use `aria-labelledby` for the visible label plus a visually hidden action word.

### B1 — Spurious startup error on every launch

`errors-in-console` (weight 1, the only weighted best-practices failure) fires on all
216 runs with:

> `[startup] the popout query did not answer within 2000ms; rendering the project window`

The query **does** answer; the message is a race bug in
`src/index.tsx` → `popoutTarget()`. `Promise.race` does not cancel the losing
timeout, and its callback calls `reportStartupFailure` unconditionally 2 s after a
successful boot. Fix by tracking settlement and only reporting if the query is still
pending (clear the timer when `query` settles, or guard with a `settled` flag). This
is a genuine desktop-app bug, not a harness artifact: every real launch logs it.

### B2 — Missing favicon (`/tauri.svg` 404)

The second `errors-in-console` item on every run:

> `Failed to load resource: the server responded with a status of 404 (Not Found)`
> `http://127.0.0.1:PORT/tauri.svg`

`index.html:7` and `preview.html` link `/tauri.svg`, but `public/` contains no such
file. Add the asset (or point both pages at an existing icon, e.g. copy
`src-tauri/icons/32x32.png` into `public/`). With B1 this takes best-practices from
96 to 100.

### C1 — Missing meta description

`meta-description` (weight 1 of 10, the whole SEO gap) fires on every run. Add a
one-line `<meta name="description">` to `index.html` and `preview.html`. The app is a
desktop shell, but the tag is free and keeps the SEO signal green.

### P1 — Analyzer tabs: LCP is the whole performance gap

Performance is 99–100 on the shell and graph/chrome surfaces, but 86–88 on analyzer
tabs. The weighted audits that differ are:

| Audit | Weight | Analyzer tabs | Chrome surfaces |
| --- | --- | --- | --- |
| `largest-contentful-paint` | 25 | **2.3 s** (score ≈ 0.52) | ~0.9 s (score ≈ 1.0) |
| `total-blocking-time` | 30 | ~71 ms (score ≈ 0.99) | ~60 ms |
| `speed-index` | 10 | ~1.34 s (score ≈ 0.91) | ~1.17 s |

FCP is ~482 ms and CLS is 0, so the gap is LCP. The LCP element is the analyzer's
empty-state hint (`div.analyzer-empty > span.empty-state-hint`), which is painted
while the first result is computed and then replaced by the chart. The LCP breakdown
reports ~580 ms of element render delay and a 128 ms long task at ~2.2 s; the canvas
chart itself is not an LCP candidate, so removing the empty state late does not move
the LCP earlier.

Contributors measured in the preview build (and the real app build for comparison):

- **Preview:** entry JS **964 kB** (includes the 444 kB analysis-fixture JSON) plus the
  vendor chunks below; CSS 196 kB.
- **Real app** (`npm run build`): entry JS **528 kB** (163 kB gzip), dockview 343 kB +
  134 kB CSS, Kobalte 175 kB, uPlot 60 kB + 1.6 kB CSS, `marked` 47 kB, `purify` 29 kB,
  app CSS 66 kB. `marked` / `purify` are already split and lazy.
- `unused-javascript` 709–819 KiB, `unused-css-rules` 178–183 KiB,
  `render-blocking-insight` 290–330 ms, `font-display-insight` 10–60 ms.
- The `popout` surface scores 100 with the same preview bundle, because it renders one
  tool with no dockview/sidebar/timeline. That isolates the shell + Workbench mount as
  the cost, not the analysis fixture alone.

Recommended direction for M32.B:

1. Keep the toolbar/sidebar/timeline on the critical path and **defer the Workbench
   vendors** (dockview, uPlot, Kobalte UI that only tab content needs) until a tab is
   opened. The empty/source surfaces already show the payoff.
2. **Lazy-load per-tool fixture data** in the preview harness (one JSON per tool,
   fetched on demand) so analyzer audits measure the app, not a 444 kB fixture blob.
   This is a harness fidelity fix, not an app fix.
3. Add `font-display: swap` (or `optional`) for the bundled fonts; preload only the
   face used by the shell.
4. Treat the `cache-insight` and `document-latency-insight` results as **not
   applicable**: the preview is served by a local Node static server without cache
   headers, while the desktop app reads bundled files from disk. Do not optimize the
   app for them.

Re-run the matrix after M32.B; the analyzer surfaces should converge toward the
chrome surfaces, and the fixture-weight caveat should disappear.

## Budgets and gating

`scripts/lighthouse/budgets.json` currently targets:

```json
{ "performance": 0.9, "accessibility": 0.95, "best-practices": 0.9, "seo": 0.9 }
```

`npm run lighthouse -- --check` fails if **any** run misses a budget. The first full
matrix fails on performance (min 83) and accessibility (min 82), and meets
best-practices (96) and SEO (90 exactly). That is the intended M32.B worklist; after
the fixes, tighten accessibility/best-practices/SEO to 1.0 and performance to ≥0.95.

CI wiring is deliberately not added yet: a 216-run job takes ~57 minutes on a laptop.
Once M32.B lands, gate a reduced matrix (one theme × both viewports) on PRs and run
the full matrix nightly.

## What is not audited

- Native Tauri surfaces (window chrome, menu, native dialogs) — Lighthouse only sees
  the webview.
- The popout surface renders `PopoutApp` in the same page; it is not a separate
  native window.
- Installed `.heyltheme` files (user data) — only the six built-ins.
- Popovers, pickers, tooltips, and focus traps beyond the About dialog.
- Capture / file-dialog / save-dialog flows (no devices or file system in the preview
  shell).
- Mobile viewports: this is a desktop app; both audited viewports are laptops.

## Reproduce

```sh
npm run lighthouse                  # full matrix (~57 min); builds the preview shell
npm run lighthouse -- --quick       # one theme + viewport, every surface
npm run lighthouse -- --only=nord --only=spectrum
npm run lighthouse -- --no-build    # reuse .lighthouse/site
npm run lighthouse -- --check       # apply scripts/lighthouse/budgets.json
npm run lighthouse:serve            # http://127.0.0.1:4174/index.html
```

Regenerate the analysis fixtures after an engine/result-shape change:

```sh
npm run lighthouse:fixtures         # needs the release app binary (batch CLI)
```

The preview shell is `preview.html`; `src/preview/fixtures.ts` installs the IPC stub
and seeds the requested surface, and `src/preview/stub.ts` answers only the commands a
rendered surface reads. The build is `HEYLISTEN_LIGHTHOUSE=1 vite build` into
`.lighthouse/site`, so `dist/` remains the shipped app.
