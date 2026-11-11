# Lighthouse audit 1 (M32)

The first automated pass over every surface the app can render. This document is the
durable summary; the raw report is generated (not committed) under
`reports/lighthouse/` and served with `npm run lighthouse:serve`. The follow-up
improvement pass and its scores are in [`lighthouse-audit-2.md`](lighthouse-audit-2.md). Each run's
`report.report.html` is Lighthouse's **official** standalone report (rendered by
`ReportGenerator`); `index.html` is only a navigator/aggregate over the LHRs, because
Lighthouse has no multi-URL report.

- **Date:** 2026-11-04
- **Lighthouse:** 13.6.0 via the Node API (`lighthouse` + `chrome-launcher`), desktop
  config, headless Chrome
- **Profiles:**
  - **full** — every category, the neutral `builtin:dark` baseline, every surface, both
    laptop viewports: 18 surfaces × 2 viewports = **36 runs**
  - **visual** — `color-contrast` only, every built-in theme, the five surfaces that
    expose the theme-token consumers, 1280×800: 6 themes × 5 surfaces = **30 runs**
- **Total:** **66 runs**. Layout/behaviour and performance do not depend on the palette,
  so the full matrix uses one theme; colors do not depend on the laptop width, so the
  theme sweep uses one viewport.
- **Viewports:** 1280×800 (`small`) and 1920×1080 (`large`), device scale 1
- **Categories:** performance, accessibility, best-practices, SEO (full runs);
  `color-contrast` (visual runs)
- **Harness:** `npm run lighthouse` (`scripts/lighthouse/run.ts`); surface list in
  `src/preview/surfaces.ts`; themes from `src/state/themes/builtins.ts`
- **Fixtures:** a deterministic 4 s WAV (`src/preview/signal.ts`) and its generated
  analyzer results (`src/preview/fixtures/analysis.json`, keyed by every analyzer in
  `AnalyzerId`), plus the empty state. One representative analyzer per
  `AnalyzerView["kind"]` is audited — the tools share renderers.

## Headline scores

Full-category runs (36; mean / min):

| Scope | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| All full runs | **89.9 / 81** | **86.5 / 82** | **96.0 / 96** | **90.0 / 90** |
| small (1280×800) | 90.4 / 83 | 86.5 / 82 | 96.0 / 96 | 90.0 / 90 |
| large (1920×1080) | 89.4 / 81 | 86.5 / 82 | 96.0 / 96 | 90.0 / 90 |

The theme sweep is separate: all 30 color runs fail `color-contrast` (0), but the
number of failing nodes and the worst ratio differ per theme — see
[A1](#a1--contrast-tokens-fail-in-every-theme). Those runs do not have category scores,
so they are not mixed into the table above.

| Surface | Performance | Accessibility | Best practices | SEO |
| --- | --- | --- | --- | --- |
| empty | 100 | 84 | 96 | 90 |
| source | 98 | 84 | 96 | 90 |
| annotations | 97 | 82 | 96 | 90 |
| waveform / levels / frameRms / melSpectrogram / modulation | 84–85 | 86 | 96 | 90 |
| spectrum | 89 | 86 | 96 | 90 |
| spectrogram | 86 | 86 | 96 | 90 |
| noteMetrics | 84 | 87 | 96 | 90 |
| tempo | 84 | 86 | 96 | 90 |
| filter / synth | 96–97 | 87 | 96 | 90 |
| compare | 82 | 86 | 96 | 90 |
| compareSeries | 86 | 86 | 96 | 90 |
| popout | **100** | 94 | 96 | 90 |
| about | 100 | 92 | 96 | 90 |

The performance gap is concentrated in **analyzer tabs and the compare view** (81–89);
the accessibility gap is app-wide — the annotations rail (82), the analyzer tabs (86–87),
and the toolbar/sidebar/source contrast. The shell, graph and dialog surfaces are
performance-clean (96–100).

## Findings for M32.A

Ordered by impact on the category scores. Each item names the owner file so the fix
can start without re-reading the report.

### A1 — Contrast tokens fail in every theme

`color-contrast` is a weighted audit (weight 7) and fails on every full run and every
theme in the sweep. The failures are not one bad element: the secondary/tertiary text
tokens are below 4.5:1 on the panel backgrounds.

| Theme | Failing selectors (sweep union) | Max nodes in one run | Worst ratio | Worst element |
| --- | --- | --- | --- | --- |
| `builtin:dark` | 11 | 27 | 3.05 | `.sidebar-subtitle` |
| `builtin:light` | 4 | 21 | 2.45 | `.sidebar-subtitle` |
| `builtin:retrowave-neon` | 4 | 21 | 2.64 | `.sidebar-subtitle` |
| `builtin:nord` | 16 | 55 | 2.19 | `.sidebar-subtitle` |
| `builtin:solarized-dark` | 23 | 61 | 2.14 | `.sidebar-subtitle` |
| `builtin:solarized-light` | 20 | 56 | 2.04 | `.sidebar-subtitle` |

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

Fix direction: raise the secondary/tertiary ramp in `src/styles/base.css` (lines
21–55 and 100–134) and in each `ui` overlay (`builtinNord.ts`, `builtinRetrowave.ts`,
`builtinSolarized.ts`), checking the values against **both** `--panel-2` and
`--panel-3`. Target 4.5:1 for normal text (3:1 only for ≥18.66 px bold / ≥24 px).
Because the worst offenders are semantic-token misuse, prefer fixing the consumers
first, then the palette. Consider a unit check in `src/tests/themeFile.test.ts` that
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

`errors-in-console` (weight 1, the only weighted best-practices failure) fires on every
full run with:

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

### P1 — Analyzer tabs and compare: LCP is the performance gap

Performance is 96–100 on the shell and graph/chrome surfaces, but 81–89 on analyzer
tabs and the compare view. The weighted audits that differ are:

| Audit | Weight | Analyzer tabs | Chrome surfaces |
| --- | --- | --- | --- |
| `largest-contentful-paint` | 25 | **2.27 s mean** (score ≈ 0.5 on the slow runs) | ~0.9 s mean |
| `total-blocking-time` | 30 | ~124 ms (score ≈ 0.9) | ~114 ms |
| `speed-index` | 10 | ~1.40 s (score ≈ 0.8–0.9) | ~1.14 s |

FCP is ~483 ms and CLS is 0, so the gap is LCP. In the slow runs the LCP element is the
analyzer/compare empty-state hint (`div.analyzer-empty > span.empty-state-hint`),
painted while the first result is computed and then replaced by the chart or comparison;
a canvas chart is not an LCP candidate, so the element's removal does not move the LCP
earlier. The LCP breakdown reports ~750–900 ms of element render delay in those runs.
Performance is a single pass and noisy (one `spectrum` run scored 94 with a 0.5 s LCP);
the mean/min in [Headline scores](#headline-scores) is the stable signal.

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

Recommended direction for M32.A:

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

Re-run the matrix after M32.A; the analyzer surfaces should converge toward the
chrome surfaces, and the fixture-weight caveat should disappear.

## Budgets and gating

`scripts/lighthouse/budgets.json` currently targets:

```json
{
  "performance": 0.9,
  "accessibility": 0.95,
  "best-practices": 0.9,
  "seo": 0.9,
  "contrast": 1
}
```

`npm run lighthouse -- --check` fails if **any** full run misses a category budget or
any visual run fails `color-contrast`. The first split pass fails on performance
(min 81), accessibility (min 82), and every visual contrast run (all six themes). That
is the intended M32.A worklist; after the fixes, tighten performance to ≥0.95 and keep
contrast at 1.

CI wiring is deliberately not added yet: the split matrix takes ~13.5 minutes on a
laptop. Once M32.A lands, gate `npm run lighthouse -- --quick` (~5 minutes) on PRs and
run the full profile nightly.

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
npm run lighthouse                    # full + visual profiles (~13.5 min)
npm run lighthouse -- --quick         # one theme/viewport, both profiles (~5 min)
npm run lighthouse -- --profile=full  # skip the theme contrast sweep
npm run lighthouse -- --only=nord --only=spectrum
npm run lighthouse -- --no-build      # reuse .lighthouse/site
npm run lighthouse -- --check         # apply scripts/lighthouse/budgets.json
npm run lighthouse:serve              # http://127.0.0.1:4174/index.html
npm run lighthouse:serve -- --port=0  # ...or a free port if 4174 is busy
```

Regenerate the analysis fixtures after an engine/result-shape change:

```sh
npm run lighthouse:fixtures         # needs the release app binary (batch CLI)
```

The preview shell is `preview.html`; `src/preview/fixtures.ts` installs the IPC stub
and seeds the requested surface, and `src/preview/stub.ts` answers only the commands a
rendered surface reads. The build is `HEYLISTEN_LIGHTHOUSE=1 vite build` into
`.lighthouse/site`, so `dist/` remains the shipped app.
