# Cross-project comparison (M25, planned)

Compare **the same analysis tool** on two independently open projects. Each project
keeps its own source, filter, synth, timeline, analysis window, shared params and tool
options; the comparison is a **view over both**, not a second track.

This preserves ADR-3 (*one window = one project = one source*) and ADR-9 (the core owns
the PCM). "Symmetric independent tracks" here means **two projects**, each complete on
its own; the only thing that spans them is the diff.

## Model

- **A** — the *owner*: the project whose window opened the comparison.
- **B** — the *reference*: another open project window (`File → New Window`).
- **Tool** — one analyzer id. A comparison is always per tool; two different tools is
  not a comparison (`Compare with…` on the Spectrum tab compares Spectrum).
- **Compare view** — a transient Workbench tab in A (`compare:<tool>`), the "diff
  window", which **pops out like any other tab** (right-click → *Pop out to window*).
  At most one per tool per project, either as a tab **or** as its popout; choosing
  another reference retargets that one view. It is not in the Sidebar and not a project
  window.
- A and B are **symmetric** in what they contribute: each side runs the tool over its
  own window, with its own params, options and filter. A is special only in that it owns
  the view.

> **Why a tab first, with a popout.** The Workbench is already the only tabbed region
> and the comparison belongs to A, so the tab reuses A's theme and UI state with no new
> boot role. It then rides the existing **popout** plumbing (ADR-11): a real Tauri window
> aliased to A, showing just the compare view. The two transient rules are the only
> extras: a compare panel is stripped from the saved layout, and a compare popout is
> never recorded as a tool popout (so it is not restored on load).

A comparison requires **two project windows**, each with a source. With one open, the
picker explains how to open another; a side without a source is disabled in the picker
and shows an empty state in the view. With MCP, the call fails with the available labels;
the CLI takes two project files.

## Entry points

| Surface | Action |
| --- | --- |
| Workbench tab menu | Right-click an **analyzer** tab → **Compare with…** → pick another project. On a **compare** tab: *Change reference…*, *Pop out to window*, *Close tab*. Only the project window has the Workbench; a popout shows no tab strip. |
| Native menu | **Analysis → Compare with…** acts on the focused analyzer tab (the root project window); with none focused it shows a transient hint instead of a dialog. |
| MCP | `compare_analysis { tool, with, target? }` (app-only). |
| CLI | `hey-listen compare A.heyl B.heyl -t TOOL` (batch, no window). |

On the compare tab itself, **Compare with…** re-targets its reference. The picker lists
every other **project** window (never a popout) with its display name, source shape and
current analysis window. A project with no source, or one whose shared state has not
initialized yet (a brand-new window), is listed but disabled.

## Compute

The core computes both sides; the frontend never holds B's PCM.

- `run_comparison` takes the caller's window (A), the reference label (B), the tool, and
  a **setup per side** (`start`/`end`, `params`, `options`).
- A's setup comes from A's stores; B's from `compare_peer_setup`, which reads B's shared
  UI state (`timeline` / `params` / `toolOptions`) and source shape. Both sides' options
  pass through the same engine-only filter `run_analysis` uses, so chart-display toggles
  never reach the engine.
- Each side reads its **own** `AudioState` PCM and filter. The slice → condition → run
  path is the existing `analysis::run_window`, so a comparison cannot drift from a
  normal tool run.
- Both runs execute on the blocking pool, sequentially. The request is debounced
  (~200 ms) and latest-wins; a peer change re-triggers it.
- A side failure (no source, an empty window, a filter error) names the side (`a` or
  `b`) so the view and MCP/CLI callers can report which project failed.
- **Peer reads never create state.** A closed reference is resolved against the live
  windows (not `WindowRegistry::get`, which lazily creates an empty state); it returns
  `None` / an error, which the view renders as the **Reference project closed** banner.
- B is **read-only**: a comparison never changes B's source, filter, window, params,
  options, transport or tabs.

### Live state (both sides)

- `compare_live(reference)` returns **both** playheads (A's and B's, from the core's
  per-window `Playback`), B's time/frequency cursor (from its shared UI state), and a
  monotonic `revision`. The modulation group joins the cross-window sync as `cursor:mod`
  / `view:mod`, so its charts get a peer cursor too.
- Reading both playheads from the core is what makes the **popout** work: it has no
  Timeline, so it cannot publish its own playhead. A's cursor still arrives through the
  shared UI state (and the popout publishes its own hover back to A).
- Polled at ~20 Hz while the compare view is mounted and visible; stopped when it is
  hidden or closed. `revision` is bumped by any peer UI or audio change, so a settled
  change re-runs the comparison without polling the whole setup.
- `compare_peer_setup(reference)` is fetched on open and whenever `revision` changes.

## Comparability

Each side may legitimately have a different window, filter or settings, so the diff is
**explicit about what can be compared**. There is no silent normalisation.

A **grid signature** decides whether a numeric delta exists:

- the tool's view family (series / spectrum / matrix / events / scalar / modulation /
  waveform);
- the analysis rate after `resampleTo`, the channel pick, `fftSize`, `hop`, `windowFn`,
  the frequency band, and the frame/bin dimensions;
- the tool options that change the grid (`nMels`, `nBands`, `nMfcc`, `barLength`, …).

`comparability` reports:

- `aligned` — the grids match, so a delta is computed;
- `overlap` — the absolute-time intersection of the two windows (empty = no delta);
- `mismatches` — every differing setting by key (`fftSize`, `windowFn`, `channel`,
  `filter`, …) with both values;
- `filtersDiffer` — both sides are compared **as processed**; a differing filter is
  listed, not "fixed".

When the **windows** differ but the grid matches, the two results are drawn on the same
absolute-time axis and the delta covers their overlap. When the **grid** differs, there is
no interpolation: the view shows the two results side by side (A/B toggle for heatmaps)
and the mismatch list, and omits the delta. When the windows do not overlap there is no
common time base, so only the two summaries and their window spans are shown.

## The delta

Per result family:

| View | Delta |
| --- | --- |
| series (spectral tracks, pitch, RMS, loudness-over-time) | B−A on matched frames in the overlap; min/max/mean/RMS of the delta, max absolute delta, Pearson correlation, matched frames |
| spectrum | B−A per bin (same band and bin count); max and mean absolute delta |
| matrix / spectrogram (mel, MFCC, chroma, contrast) | B−A per frame×band in the overlap; max/mean absolute delta and dimensions |
| rhythm | onset-strength envelope delta plus paired events |
| events (`onsets`, `downbeats`, `noteMetrics`) | events paired by nearest time within a tolerance (`max(20 ms, 2 hops)`; 50 ms default): matched pairs, only-A, only-B, mean \|Δt\| |
| modulation | AM/FM spectra aligned by modulation-rate bin; delta per line |
| waveform | envelope delta when both windows are identical (bucket *i* covers the same span); otherwise no delta |
| readouts (levels, LUFS, LRA) | field-by-field delta over the scalar result |

The default output is **stats**, not arrays. Raw delta arrays are included only on
request (MCP `includeData`, CLI `--full`) and are thinned by `maxPoints` for
series/matrices. Event lists are never thinned. Each side keeps the existing canonical
`summary`; the comparison adds a `diff.summary` line (e.g. `Δ rms −1.2 dB · Δ peak
0.8 dB`).

**M25 vs M25.A.** The core delta for **every** family ships in M25, so MCP and the CLI
can compare any tool. The **views** ship in two steps: M25 covers **series, spectrum and
readouts** (which includes pitch, every spectral series, momentary loudness and the
level/LUFS/LRA cards); **M25.A** adds matrix/spectrogram, rhythm/events, `noteMetrics`,
modulation and waveform. Until M25.A, *Compare with…* is offered only for the tools M25
can chart; the rest still compare through MCP/CLI.

## The compare view

- **Tab title** `Compare: <Tool> — <A> ↔ <B>`. The header names A and B by **project**
  (with their source shape: rate / channels / duration), the **comparability badge**, and
  **Swap A/B** (display only; the delta sign flips).
- **Chart**, by family:
  - series / spectrum: A and B overlaid in `compareA` / `compareB`, with an optional Δ
    line (default off); a differing grid switches to two side-by-side plots rather than
    interpolating;
  - matrix / spectrogram (M25.A): a segmented control **A / B / Δ** (Δ uses a diverging
    ramp);
  - events / rhythm (M25.A): A's markers above the axis, B's below, matched pairs linked;
  - modulation / waveform (M25.A): overlaid lines / envelope, or side by side when the
    windows differ;
  - readouts: three columns (A, B, Δ).
- **Both cursors.** A's cursor is the normal crosshair (and mirrors A's other charts);
  B's is a read-only dashed rule in `compareB`, labelled **B**, from `compare_live`.
  On a frequency / modulation-rate chart it is the matching axis value; on a time chart
  it is the peer time cursor.
- **Both playheads.** A's transport playhead (the existing rule) and B's peer playhead,
  both labelled. They are drawn on time-axis charts; frequency / rate charts have no
  playhead.
- **B's analysis window** is drawn as a faint band, so a window difference is visible
  rather than only listed.
- The compare chart joins A's `time` / `freq` / `mod` sync group: it follows A's zoom and
  publishes A's cursor. It never publishes to B.
- Empty / error states: peer closed, peer has no source, no overlap, grids differ.

### Popout

- The compare tab uses the normal popout path: **Pop out to window** closes the tab and
  creates a native window (a `popout-*` label) aliased to A. It is registered as a
  **compare popout** (`tool` + `reference`) rather than a tool popout, and its title is
  `Compare: <Tool> — <A> ↔ <B>`. The popout boot asks `popout_compare` alongside the
  tool/note queries and renders the compare view in the popout shell; its picker calls
  `retarget_compare_popout`.
- **One compare view per tool per project.** If it is already popped out, choosing the
  same tool again raises the window; choosing another reference **retargets** that window
  instead of opening a second one. Closing the popout forgets the view, and *Compare
  with…* opens a tab again (the normal tool-popout behaviour).
- The popout pulls A's shared state (window/params/options) through the alias and reads
  B through the same peer commands. It has no Timeline, so both playheads come from
  `compare_live`; A's cursor still arrives through the shared UI state, and hovering the
  popout's chart publishes A's cursor to the project window.
- Compare popouts are **not** in `LAYOUT.popouts` (`popout_tools_of` returns tool
  popouts only) and `sync_popouts` never opens them. `close_popouts` on load / New
  Project closes them with the rest of the old project's views.
- Closing A closes its compare popout (the alias); closing B leaves the banner and stops
  live updates.

## Transient by construction

A comparison is not project content:

- not written to the project file — `LAYOUT` is sanitised to drop compare panels,
  `SETUP.openTools` excludes them, and `popout_tools_of` never returns a compare popout;
- not in `RESULTS`, not in undo/redo snapshots, not in the dirty signature, not in
  Recent;
- saving while it is open writes the project exactly as if it were closed; loading never
  restores it;
- closing the reference project leaves the last result on screen with a **Reference
  project closed** banner and stops live updates;
- a project load / New Project closes compare tabs **and** popouts (via `close_popouts`);
  undo restores the dockview layout and closes a compare tab, while a compare popout
  behaves like a tool popout and survives until closed.

The **peer choice is not remembered** between sessions.

## MCP

`compare_analysis` (app-only):

```json
{ "tool": "spectrum", "with": "main-2", "target": "main",
  "includeData": false, "maxPoints": 512, "summaryOnly": false }
```

Returns:

```json
{ "tool": "spectrum",
  "a": { "project": "…", "source": "…", "window": {}, "params": {}, "options": {},
         "summary": {}, "result": {} },
  "b": { "…": "…" },
  "comparability": { "aligned": true, "overlap": {}, "mismatches": [],
                     "filtersDiffer": false },
  "diff": { "kind": "spectrum", "summary": "…", "maxAbs": 4.2 } }
```

- `target` selects A (focused by default); `with` selects B.
- `includeData` / `maxPoints` / `axis` / `summaryOnly` mirror `run_analysis`, applied to
  both sides and to the delta.
- `display` (default true) opens / focuses the compare view when that tool's family has
  one (M25: series/spectrum/readouts; M25.A adds the rest). For an unsupported family the
  call still returns both results, the comparability and the diff, without a view.
- Headless answers **requires the app** — a comparison needs two live windows. Use the
  CLI for a windowless diff.

`list_projects` gains `source` (rate / channels / duration), `window` and `hasFilter`, so
an agent can pick a reference and predict comparability. `get_state` reports the open
compare views as `compare: [{ tool, with }]` — they are transient, so they are **not** in
`openTools`.

## CLI

```text
hey-listen compare <A.heyl> <B.heyl> -t <TOOL> [options]
```

- Both positionals are project files. Each side's **saved setup** (window, shared params,
  tool options, `filterEnabled`) and its `LAYOUT.filterSpec` are used.
- `-t` is repeatable; one output line per tool.
- `--start` / `--end` override both sides; `--a-start` / `--a-end` / `--b-start` /
  `--b-end` override one. `--overlap` clips both to their intersection.
- `-p` / `-o` patch both sides; `--filter` overrides both saved filters.
- `--full` / `--summary` / `--pretty` / `--fail-fast` as in `analyze`.
- A reference project (`embedSource: false`) decodes its `SOURCE.path`.
- A project saved before `LAYOUT.filterSpec` existed compares **unfiltered** and prints a
  one-line warning to stderr (the saved editor graph cannot be compiled without the
  param order).

Output (JSONL, one line per tool):

```json
{"tool":"spectrum",
 "a":{"file":"a.heyl","window":{},"params":{},"options":{},"summary":{},"result":{}},
 "b":{"file":"b.heyl","…":"…"},
 "comparability":{"aligned":true,"overlap":{},"mismatches":[],"filtersDiffer":false},
 "diff":{"kind":"spectrum","summary":"…","maxAbs":4.2}}
```

Exit `0` when every tool ran, `1` when either side failed, `2` on a usage error.

## Performance

- Comparison doubles the analysis work; the request is debounced and latest-wins, and
  closed tabs compute nothing.
- The UI asks for full arrays (the charts need them); MCP/CLI default to compact/raw-free.
- No result cache is introduced. Re-running the same comparison recomputes; a shared
  cache keyed by `(project, tool, window, params, options, filter)` is a possible
  follow-up (it is also what `RESULTS` caching would need).

## Not in scope (M25)

- No second track inside one project; ADR-3 is unchanged.
- No alignment beyond absolute time (no DTW / cross-correlation / time warping).
- No simultaneous mixed playback; each project's transport stays its own. A/B switching
  is done by playing the other window.
- No comparison of **different** tools, and no "compare 3+" projects.
- No notes in the compare view (annotations belong to a project).
- No parameter matching / normalisation. Mismatches are reported, never silently fixed.
- No persistence or export of a comparison (saving is explicitly excluded; an export is a
  possible follow-up once M12 exists). Compare tabs and popouts are both transient.
- No comparison of a *popout's* own state; the popout is a view of the same project.
- No audio-file compare in the CLI (save a project first); `analyze` covers files.
- No dual waveform Timeline in the compare view — each project keeps its own Timeline;
  the compare chart shows B's analysis window as a band.
- **M25 only:** the matrix/spectrogram, rhythm/event, `noteMetrics`, modulation and
  waveform **views** are M25.A (their core deltas and MCP/CLI results ship in M25).

## Files

**Core** — `src-tauri/src/audio/analysis/compare/{mod,align,diff,tests}.rs`,
`src-tauri/src/commands/{compare,window}.rs` (comparison + compare popout windows),
`src-tauri/src/state/{mod,window}.rs` (revision + peer reads + compare-popout map),
`src-tauri/src/menu.rs` (Analysis menu), `src-tauri/src/lib.rs` (register).

**Frontend** — `src/state/compare/` (`targets`, `run`, `live`, `id`, `picker`,
`popout`), `src/components/compare/` (`CompareTab`, `CompareHeader`, `CompareSeries`,
`CompareSpectrum`, `CompareReadouts`, `peerPlugins`), `src/lib/dockviewLayout.ts`
(sanitiser: drop compare panels, prune empty groups, re-point `activeGroup` /
`activeView` if they were one),
`src/state/{workbench,uiState,menu,history,snapshot}.ts`,
`src/state/project/{snapshot,types}.ts` (`filterSpec`),
`src/components/{Workbench,ToolContent,App}.tsx`, `src/index.tsx`, `src/PopoutApp.tsx`,
`src/lib/themeFile.ts`, `src/state/themes/chart.ts`, `src/styles/compare.css`.
**M25.A** adds `CompareMatrix`, `CompareEvents`, `CompareModulation` and `CompareWaveform`
under `src/components/compare/`.

**Surfaces** — `src-tauri/src/mcp/tools/` (`mod` + `compare`),
`src/state/mcp/` (`dispatch`, `analyze`), `src-tauri/src/cli/batch/` (`compare`, `args`,
`types`, `mod`), `src-tauri/tauri.conf.json` (`compare` subcommand).

## Tests

- **Rust unit** — grid signature, overlap, series/spectrum/matrix delta, event pairing,
  scalar delta, no-overlap, mismatch list, and shaping.
- **Rust integration** — `run_comparison` against two `WindowState`s (different sources
  and filters), reference resolution (root labels only), and the peer reads.
- **Unit (TS)** — dockview sanitiser (compare panels removed, empty groups pruned, an
  active compare group re-pointed), compare panel id parsing, peer poll latest-wins, and
  the picker's target filtering.
- **E2E `r2-compare`** — two projects with distinct tones: Compare with… from Spectrum
  shows both series and the legend; B's cursor and B's playhead appear on the compare
  chart and follow B; a differing FFT size shows the badge and no delta; closing B shows
  the banner; saving A and reopening has no compare tab; retargeting reuses the tab.
- **E2E popout** — *Pop out to window* closes the compare tab and shows a window titled
  `Compare: Spectrum — <B>` with the same overlay; B's cursor/playhead still follow; A's
  hover in the popout moves A's cursor in the project window; closing the popout forgets
  the view; a project load closes it and does not restore it.
- **MCP** — `compare_analysis` with `target`/`with`, compact/full/summary, an unknown
  reference, a matrix tool (core diff without a view), and the headless "requires the
  app" answer.
- **CLI** — `compare a.heyl b.heyl -t spectrum --summary`, mismatch, no overlap, a
  reference project, a missing `filterSpec` warning, and the exit codes.
- **M25.A** — one view test per added family (matrix A/B/Δ, rhythm/event pairing,
  `noteMetrics` pairing, modulation, waveform’s identical-window rule).

## Delivery order

**M25**

1. Core: comparison engine **for every family**, comparability, `compare_live` /
   `compare_peer_setup`, the revision counter, and `run_comparison` (+ unit tests). No UI.
2. The compare view for **series / spectrum / readouts**, the tab menu + Analysis menu +
   picker, both cursors / playheads, **popout**, and the transient boundary (sanitiser,
   dirty, history, save, compare-popout lifecycle).
3. **MCP `compare_analysis`**, `list_projects` enrichment, **CLI `compare`** and
   `LAYOUT.filterSpec`, then the E2E/unit/docs pass.

**M25.A**

4. **Matrix / spectrogram, rhythm / events, `noteMetrics`, modulation and waveform**
   views, then enable *Compare with…* for every tool and add the per-family view tests.

M25 is fully usable for the common charts and fully scriptable for every tool; M25.A
completes the visual matrix.

> **Decision:** comparisons are transient cross-project views computed by the core, not a
> second track and not project content. See ADR-24.
