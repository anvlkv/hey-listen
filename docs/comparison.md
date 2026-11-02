# Cross-project comparison (M25)

Compare **the same analysis tool** on two project sides. Each side keeps its own source,
filter, synth, timeline, analysis window, shared params and tool options; the comparison
is a **view over both**, not a second track. The reference side is normally another open
project window, or the owner's **saved snapshot** of the last comparison (M25.C).

This preserves ADR-3 (*one window = one project = one source*) and ADR-9 (the core owns
the PCM). "Symmetric independent tracks" here means **two projects**, each complete on its
own; the only thing that spans them is the diff.

Since **M25.B** the two sides share a **relative time axis** (each window starts at 0)
with a manual fine-tune offset δ, and the delta covers their **common span**, not an
absolute-time overlap (ADR-26). Since **M25.C** the last comparison is saved in the
project as a **reference snapshot**, so A can be reopened alone (ADR-27). Both supersede
parts of the original M25 contract; sections below say which rule applies.

## Model

- **A** — the *owner*: the project whose window opened the comparison.
- **B** — the *reference*: another open project window (`File → New Window`), or the saved
  snapshot of one (M25.C).
- **Tool** — one analyzer id. A comparison is always per tool; two different tools is
  not a comparison (`Compare with…` on the Spectrum tab compares Spectrum).
- **Compare view** — a Workbench tab in A (`compare:<tool>`), the "diff window", which
  **pops out like any other tab** (right-click → *Pop out to window*). At most one per
  tool per project, either as a tab **or** as its popout; choosing another reference
  retargets that one view. It is not in the Sidebar and not a project window.
- **Reference kind** — a view binds either to a **live** project window (the M25 model)
  or to A's **saved snapshot** of its last comparison (M25.C). Live wins when a project is
  reconnected; a saved binding needs no second window open.
- A and B are **symmetric** in what they contribute: each side runs the tool over its
  own window, with its own params, options and filter. A is special only in that it owns
  the view and defines the axis extent.

> **Why a tab first, with a popout.** The Workbench is already the only tabbed region
> and the comparison belongs to A, so the tab reuses A's theme and UI state with no new
> boot role. It then rides the existing **popout** plumbing (ADR-11): a real Tauri window
> aliased to A, showing just the compare view. A compare panel is still stripped from the
> saved dockview layout, and a compare popout is never recorded as a tool popout; the
> comparison's **content** is saved separately (M25.C), and a saved comparison restores
> as a tab, not as a window.

A **live** comparison requires **two project windows**, each with a source. With one open,
the picker explains how to open another; a side without a source is disabled in the picker
and shows an empty state in the view. With MCP, the call fails with the available labels;
the CLI takes two project files. With **M25.C**, a project that has a saved comparison
can show it with one window open; restoring a saved comparison never invents a peer.

## Entry points

| Surface | Action |
| --- | --- |
| Workbench tab menu | Right-click an **analyzer** tab → **Compare with…** → pick another project. On a **compare** tab: *Change reference…*, *Pop out to window*, *Close tab*. Only the project window has the Workbench; a popout shows no tab strip. |
| Native menu | **Analysis → Compare with…** acts on the focused analyzer tab (the root project window); with none focused it shows a transient hint instead of a dialog. |
| MCP | `compare_analysis { tool, with, target?, bOffset?, saved? }` — a live project label (app) or a project file path (headless, M25.D). |
| CLI | `hey-listen compare A.heyl B.heyl -t TOOL [--b-offset SECS]` (batch, no window). |

On the compare tab itself, **Compare with…** re-targets its reference. The picker lists
every other **project** window (never a popout) with its display name, source shape and
current analysis window, plus the project's **saved snapshot** (`Saved: <name>`) when one
exists (M25.C). A project with no source, or one whose shared state has not initialized
yet (a brand-new window), is listed but disabled. Reconnect is **explicit**: when an open
project's name matches the snapshot the picker hints it, but never rebinds on its own.

## Compute

The core computes both sides; the frontend never holds B's PCM.

- `run_comparison` takes the caller's window (A), the reference label (B) **or the saved
  snapshot** (M25.C), the tool, a **setup per side** (`start`/`end`, `params`, `options`),
  and the fine-tune offset **`bOffset`** (M25.B).
- A's setup comes from A's stores; B's from `compare_peer_setup`, which reads B's shared
  UI state (`timeline` / `params` / `toolOptions`) and source shape. Both sides' options
  pass through the same engine-only filter `run_analysis` uses, so chart-display toggles
  never reach the engine.
- Each side reads its **own** `AudioState` PCM and filter. The slice → condition → run
  path is the existing `analysis::run_window`, so a comparison cannot drift from a
  normal tool run. A saved reference is already a result: the core runs **only A** and
  diffs against the stored B.
- Both runs execute on the blocking pool, sequentially. The request is debounced
  (~200 ms) and latest-wins; a peer change (or a slider move) re-triggers it.
- **Relative matching (M25.B).** The frontend and the core match frames and events at
  `x = t − result.windowStart` (plus `bOffset` for B), never at absolute source seconds.
  The core returns delta `times` in that relative axis. The per-side analyzer results are
  unchanged by the offset; only the matching moves.
- **Coordinates.** The core works in **owner coordinates**: owner A starts at 0 and the
  reference B is shifted by `bOffset` (δ). `Swap A/B` is a **display transform** — the
  displayed side is anchored at 0 and the other is shifted by −δ — so the core contract
  and `bOffset`'s meaning do not change with the swap; only the Δ sign flips.
- **Common span (M25.B).** In owner coordinates the delta and pairings cover
  `[max(0, δ), min(durA, δ + durB)]` — the longer side is clipped to the shorter. The
  displayed span is the same interval mapped by the swap transform.
- A side failure (no source, an empty window, a filter error) names the side (`a` or
  `b`) so the view and MCP/CLI callers can report which project failed.
- **Peer reads never create state.** A closed live reference is resolved against the
  open windows (not `WindowRegistry::get`, which lazily creates an empty state); it
  returns `None` / an error, which the view renders as the **Reference project closed**
  banner. With a saved snapshot there is nothing to resolve: the view shows the stored B
  and says **saved reference**.
- B is **read-only**: a comparison never changes B's source, filter, window, params,
  options, transport or tabs.

### Live state (both sides)

Applies to a **live** reference; a saved reference has no live B (no playhead, no peer
cursor; B's band comes from the snapshot).

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

- `aligned` — the grids match, so a delta is computed. **Overlap is not required** (M25.B):
  two windows at different source seconds are still comparable because the axis is
  relative;
- `alignment` — `{ aDuration, bDuration, bOffset, common }` in **owner coordinates**,
  where `common` is the relative span `[max(0, δ), min(durA, δ + durB)]` the delta covers
  (`null` when the span is empty, i.e. the shifted windows do not meet) (M25.B);
- `overlap` — the **absolute** intersection of the two windows, kept as information and
  used by the CLI's `--overlap`; it no longer gates the delta;
- `mismatches` — every differing setting by key (`fftSize`, `windowFn`, `channel`,
  `filter`, …) with both values;
- `filtersDiffer` — both sides are compared **as processed**; a differing filter is
  listed, not "fixed".

When the **windows** differ but the grid matches, both results are drawn from 0 and the
delta covers the common span; the longer side is clipped, and the chart still paints the
**displayed A** side's full extent. When the windows (after δ) do not meet at all, there
is no common span: the chart still draws both, but no delta. When the **grid** differs,
there is no interpolation:
the view shows the two results side by side (A/B toggle for heatmaps) and the mismatch
list, and omits the delta. A saved reference reports the same fields; `alignment` uses the
snapshot's window, so the saved comparison is reproducible.

## The delta

Per result family:

| View | Delta |
| --- | --- |
| series (spectral tracks, pitch, RMS, loudness-over-time) | B−A on matched **relative** frames inside the common span; min/max/mean/RMS of the delta, max absolute delta, Pearson correlation, matched frames |
| spectrum | B−A per bin (same band and bin count); max and mean absolute delta |
| matrix / spectrogram (mel, MFCC, chroma, contrast) | B−A per frame×band inside the common span; displayed A's frames are the columns, and a frame with no B counterpart is a **null** column (transparent, ignored by the stats); max/mean absolute delta and dimensions |
| rhythm | onset-strength envelope delta plus paired events, all on the relative axis |
| events (`onsets`, `downbeats`, `noteMetrics`) | events paired by nearest **relative** time within a tolerance (`max(20 ms, 2 hops)`; 50 ms default) inside the common span: matched pairs, only-A, only-B, mean \|Δt\| |
| modulation | AM/FM spectra aligned by modulation-rate bin; delta per line |
| waveform | envelope delta over the common span. Buckets are 2048 per window with a length-dependent step, so M25.B samples the other envelope at **A's** bucket times (nearest within one bucket; the view maps to display coordinates after a swap); exact when the durations match, and the view says *clipped to the shorter window* when they do not |
| readouts (levels, LUFS, LRA) | field-by-field delta over the scalar result |

The default output is **stats**, not arrays. Raw delta arrays are included only on
request (MCP `includeData`, CLI `--full`) and are thinned by `maxPoints` for
series/matrices: parallel arrays are thinned together (`times` / `values` / `a` / `b`,
and whole frames for a matrix), a waveform reports `sourceBuckets` when thinned, and the
stats still describe the full comparison. Event lists are never thinned. `axis:
"compact"` applies to the delta's relative `times` as well as the side results (an
overlap-add edge frame is carried as `firstHop` / `lastHop`). Each side keeps the
existing canonical `summary`; the comparison adds a `diff.summary` line (e.g. `Δ rms
−1.2 dB · Δ peak 0.8 dB`).

**Views.** The core delta ships for **every** family, and the compare view charts all of
them: **series, spectrum and readouts** (pitch, every spectral series, momentary loudness,
the level/LUFS/LRA cards) plus **matrix/spectrogram, rhythm/events, `noteMetrics`,
modulation and waveform** (M25.A). *Compare with…* is offered for every analyzer.

## The compare view

- **Tab title** `Compare: <Tool> — <A> ↔ <B>`. The header names A and B by **project**
  (with their source shape: rate / channels / duration), the **comparability badge**, the
  **fine-tune slider** (M25.B), and **Swap A/B**.
- **Relative time.** Time-axis charts read `elapsed (s)`: displayed A starts at 0 at its
  window start, and displayed B's own window start sits at +δ on that axis (so B's result
  also begins at 0). The axis extent is the **displayed A** side's duration; displayed B
  is clipped where its data ends.
- **Fine-tune slider (δ).** It moves displayed B relative to displayed A: ±1 s, 1 ms
  steps, 0 by default, positive = B later, with a reset. It only re-aligns the results
  (no re-analysis); the comparison re-runs debounced, so the Δ line, stats and pairings
  follow. It is shown for the time-axis families (series, matrix/spectrogram, events,
  notes, waveform); spectrum/modulation/readouts have no time axis and no slider.
- **Swap A/B** swaps the sides, the **axis extent and clipping**, and the offset's sign —
  not only the labels and the Δ sign. The slider always moves the side shown as B.
- **Chart**, by family:
  - series / spectrum: A and B overlaid in `compareA` / `compareB`, with an optional Δ
    line (default off); a differing grid switches to two side-by-side plots rather than
    interpolating;
  - matrix / spectrogram: a segmented control **A / B / Δ** (Δ uses a diverging
    ramp);
  - events / rhythm: A's markers above the axis, B's below, matched pairs linked;
  - modulation: overlaid AM/FM lines on the rate axis;
  - waveform: overlaid peak envelopes clipped to the common span (side by side only
    when the **grid** differs, never merely because the windows differ);
  - readouts: three columns (A, B, Δ).
- **Both cursors.** A's cursor is the normal crosshair (and mirrors A's other charts);
  B's is a read-only dashed rule in `compareB`, labelled **B**, from `compare_live`.
  On a frequency / modulation-rate chart it is the matching axis value; on a time chart
  it is the peer time cursor.
- **Both playheads.** A's transport playhead (the existing rule) and B's peer playhead,
  both labelled. They are drawn on time-axis charts; frequency / rate charts have no
  playhead.
- **B's analysis window** is drawn as a faint band at `[δ, δ + bDur]`, so a window
  difference is visible rather than only listed.
- **Markers are remapped** onto the relative axis (owner coordinates): A's
  playhead/cursor at `t − aStart`, B's at `t − bStart + δ`; the swap transform then moves
  them into display coordinates. The compare chart stays in A's `time` / `freq` / `mod`
  sync group by converting absolute ↔ relative at the plugin boundary, so A's zoom and
  cursor still mirror the project's other charts.
- **Saved reference (M25.C).** The badge/banner says **saved reference**; B's band comes
  from the snapshot and B has no live playhead/cursor.
- **Reference project button (M25.D).** Beside the reference picker: a **live** reference
  reads **Show reference** and raises that project's window; a **saved** reference reads
  **Open reference** and opens the reference **file recorded with the snapshot** (raising
  a window that already shows it). Nothing is resolved by name — two projects can share a
  display name, and an origin project's title can share a prefix with the owner's file.
  A snapshot without a recorded path (a comparison made against an unsaved project, or a
  file saved by an older build) and a reference file that has since been deleted both
  report a transient notice. It never rebinds the comparison.
- Empty / error states: peer closed (live), peer has no source, grids differ; a saved
  reference never reports "no overlap" — its common span is computed from the snapshot.
- **A cramped panel scrolls.** The header (whose tools row wraps), readouts and banners keep
  their height and the chart area keeps a 200 px minimum, so a short Workbench panel (a
  small window, a split group) scrolls the view instead of squeezing the chart to 0 px —
  `uPlot` draws nothing at all when its plot area has no height.

### Popout

- The compare tab uses the normal popout path: **Pop out to window** closes the tab and
  creates a native window (a `popout-*` label) aliased to A. It is registered as a
  **compare popout** (`tool` + `reference`) rather than a tool popout, and its title is
  `Compare: <Tool> — <A> ↔ <B>`. The popout boot asks `popout_compare` alongside the
  tool/note queries and renders the compare view in the popout shell; its picker calls
  `retarget_compare_popout`.
- **One compare view per tool per project.** If it is already popped out, choosing the
  same tool again raises the window; choosing another reference **retargets** that window
  instead of opening a second one. Closing the popout forgets the live view (a saved
  snapshot, if any, survives in the project), and *Compare with…* opens a tab again (the
  normal tool-popout behaviour).
- The popout pulls A's shared state (window/params/options) through the alias and reads
  B through the same peer commands. It has no Timeline, so both playheads come from
  `compare_live`; A's cursor still arrives through the shared UI state, and hovering the
  popout's chart publishes A's cursor to the project window.
- Compare popouts are **not** in `LAYOUT.popouts` (`popout_tools_of` returns tool
  popouts only) and `sync_popouts` never opens them. `close_popouts` on load / New
  Project closes them with the rest of the old project's views. Their comparison content
  is saved like a tab's (M25.C), but the **window** is not restored.
- Closing A closes its compare popout (the alias); closing a live B leaves the last result
  with a **Reference project closed** banner and stops live updates (the snapshot, if
  any, remains).

## Lifecycle: live view, saved snapshot

The compare **panel** stays out of the dockview layout: `LAYOUT` is sanitised to drop
compare panels, `SETUP.openTools` excludes them, and `popout_tools_of` never returns a
compare popout. Since **M25.C** the comparison **content** is project content:

- `save_project` writes one snapshot per comparison open at save time (tab **or**
  popout) into the `COMPARE` section — B's last analysis window, not its audio. If the
  live reference has since closed, the **last successful** result is saved (the one the
  banner keeps). A comparison that never resolved writes nothing.
- `load_project` restores them as Workbench **tabs** (never as popout windows), bound to
  the saved snapshot until the user reconnects a live project;
- while a compare view is open, a **settled** change in B's result is part of A's dirty
  signature (the saved snapshot would change), so closing A prompts; snapshots stay out of
  undo/redo and Recent;
- closing a compare tab and saving drops its snapshot (one saved comparison per tool);
- a project load / New Project closes compare tabs **and** popouts (via `close_popouts`),
  then re-opens the saved ones after the project state is ready; undo restores the
  dockview layout and closes a compare tab, while a compare popout behaves like a tool
  popout and survives until closed.

The peer choice is remembered through the snapshot; it is not reconnected automatically.
The picker offers the saved entry and hints when an open project has the same name.

## MCP

`compare_analysis` (app / headless, M25.D):

```json
{ "tool": "spectrum", "with": "main-2", "target": "main", "bOffset": 0.012,
  "includeData": false, "maxPoints": 512, "summaryOnly": false }
```

Returns:

```json
{ "tool": "spectrum",
  "a": { "project": "…", "source": "…", "window": {}, "params": {}, "options": {},
         "summary": {}, "result": {} },
  "b": { "…": "…" },
  "comparability": { "aligned": true,
                     "alignment": { "aDuration": 1.0, "bDuration": 0.8,
                                    "bOffset": 0.012,
                                    "common": { "start": 0.012, "end": 0.812 } },
                     "overlap": {}, "mismatches": [], "filtersDiffer": false },
  "diff": { "kind": "spectrum", "summary": "…", "maxAbs": 4.2 } }
```

- `target` selects A (focused by default); `with` selects B; `bOffset` is the fine-tune
  offset in seconds (M25.B; positive moves B later). It defaults to **0** for a live
  reference and to the **snapshot's stored offset** for a saved one (M25.C).
- `saved: true` (M25.C) uses A's saved snapshot for B and omits `with`; a live reference
  is ignored then.
- `includeData` / `maxPoints` / `axis` / `summaryOnly` mirror `run_analysis`, applied to
  both sides and to the delta.
- `diff` is omitted when the grids differ or when the shifted windows do not meet
  (`alignment.common` is `null`). `savedFingerprint` is the content fingerprint of the
  reference snapshot that would be saved (the frontend's dirty signature uses it).
- `display` (default true) opens / focuses the compare view. Every family now has one
  (`Compare with…` is offered for every analyzer).
- `compare_analysis` runs with two project windows (a live reference) or one window plus
  a **saved snapshot** (M25.C). **Headless (M25.D)** it compares the session's project
  against a project **file**: `with` is the `.heyl` path and B runs with that file's saved
  setup, window, options and `LAYOUT.filterSpec`; `saved: true` reuses the session's stored
  snapshot. Either way the last successful comparison is kept in the session, so
  `save_project` writes it into `COMPARE`, and the app restores it as a compare tab;
  headless `get_state.savedComparisons` lists what `saved: true` can use, and
  `save_project` creates the target's parent folders.
  The **Reference project** button in the header (`open_reference_window`) raises a live
  reference's window, or opens the file recorded with a saved snapshot (M25.C stores the
  reference project's **path**; there is no name-based fallback). To script the same
  two-window comparison, open the reference with `open_project_window { path }` and pass
  the returned label as `with`.

`list_projects` gains `source` (rate / channels / duration), `window`, `hasFilter` and the
project's **saved comparisons** (tool + reference name + window), so an agent can pick a
reference and predict comparability. `get_state` reports the open compare views as
`compare: [{ tool, with, saved, offset }]` — they are **not** in `openTools`.

## CLI

```text
hey-listen compare <A.heyl> <B.heyl> -t <TOOL> [options]
```

- Both positionals are project files. Each side's **saved setup** (window, shared params,
  tool options, `filterEnabled`) and its `LAYOUT.filterSpec` are used.
- `-t` is repeatable; one output line per tool.
- `--start` / `--end` override both sides; `--a-start` / `--a-end` / `--b-start` /
  `--b-end` override one. `--b-offset <SECS>` sets the fine-tune offset (M25.B).
- Matching is **relative** by default (each side starts at 0; the delta covers the common
  span). `--overlap` still clips both windows to their **absolute** intersection first,
  for a strict "same source seconds" comparison.
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
 "comparability":{"aligned":true,"alignment":{},"overlap":{},"mismatches":[],
                  "filtersDiffer":false},
 "diff":{"kind":"spectrum","summary":"…","maxAbs":4.2}}
```

Exit `0` when every tool ran, `1` when either side failed, `2` on a usage error.

## Performance

- Comparison doubles the analysis work; the request is debounced and latest-wins, and
  closed tabs compute nothing. A **saved reference** runs only A, so it costs one side.
- The UI asks for full arrays (the charts need them); MCP/CLI default to compact/raw-free.
- A saved snapshot is one analysis result per comparison (a 512-frame spectrogram is
  roughly 0.5 MB `postcard`); it is loaded with the project, not recomputed.
- No result cache is introduced. Re-running the same comparison recomputes; a shared
  cache keyed by `(project, tool, window, params, options, filter)` is a possible
  follow-up (it is also what `RESULTS` caching would need).

## Not in scope (M25, M25.B, M25.C)

- No second track inside one project; ADR-3 is unchanged.
- No **automatic** alignment: no DTW, cross-correlation or time stretching. The alignment
  is the relative window origin plus the manual offset (M25.B).
- No simultaneous mixed playback; each project's transport stays its own. A/B switching
  is done by playing the other window.
- No comparison of **different** tools, and no "compare 3+" projects.
- No notes in the compare view (annotations belong to a project).
- No parameter matching / normalisation. Mismatches are reported, never silently fixed.
- No export of a comparison. Saved snapshots are project content (M25.C), but there is no
  standalone comparison file.
- No B **audio** in the project — only B's last analysis result; editing B afterwards does
  not update A's saved comparison until it is compared and saved again.
- No **automatic** reconnect to a same-named project; reconnect is explicit.
- One saved comparison per tool (no reference history).
- No comparison of a *popout's* own state; the popout is a view of the same project.
- No audio-file compare in the CLI (save a project first); `analyze` covers files.
- The CLI compares two project files; comparing **one** file against its saved snapshot
  is a follow-up.
- No dual waveform Timeline in the compare view — each project keeps its own Timeline;
  the compare chart shows B's analysis window as a band.
- **M25 only:** the matrix/spectrogram, rhythm/event, `noteMetrics`, modulation and
  waveform **views** were M25.A; they are delivered (their core deltas and MCP/CLI results
  shipped in M25).

## Files

**Core** — `src-tauri/src/audio/analysis/compare/{mod,align,diff,diff/families,events,stats,saved,compare/tests}.rs`,
`src-tauri/src/audio/analysis/results/mod.rs` (`windowStart` origins) and
`results/stored.rs` (the postcard-safe result mirror for saved snapshots),
`src-tauri/src/project/{mod,sections,read,write}.rs` (`COMPARE`,
M25.C), `src-tauri/src/commands/compare/{mod,peer,popout}.rs` (comparison, reference
reads, popout), `src-tauri/src/commands/{window,project}.rs` (windows, save/load),
`src-tauri/src/state/{mod,window}.rs` (revision, peer reads,
compare-popout map, saved snapshots), `src-tauri/src/menu.rs` (Analysis menu),
`src-tauri/src/lib.rs` (register).

**Frontend** — `src/state/compare/` (`targets`, `run`, `live`, `id`, `picker`, `views`,
`popout`), `src/components/compare/` (`CompareTab`, `CompareHeader` (offset slider),
`CompareSeries`, `CompareSpectrum`, `CompareReadouts`, `CompareMatrix`, `CompareEvents`,
`CompareNotes`, `CompareModulation`, `CompareWaveform`, plus the shared chart parts
`CompareCanvas`, `ComparePlot`, `axes`, `canvasOverlays`, `peerPlugins`, `sides` and the
pure helpers `align` (relative merge), `matrix`, `events`, `notes`, `waveform`),
`src/lib/dockviewLayout.ts` (sanitiser: drop compare panels from the layout, prune empty
groups, re-point `activeGroup` / `activeView` if they were one),
`src/state/{workbench,uiState,menu,history,snapshot}.ts`,
`src/state/project/{snapshot,types}.ts` (`filterSpec`, saved comparisons),
`src/components/{Workbench,ToolContent,App}.tsx`, `src/index.tsx`, `src/PopoutApp.tsx`,
`src/lib/themeFile.ts`, `src/state/themes/chart.ts`, `src/styles/{compare,compareViews}.css`.

**Surfaces** — `src-tauri/src/mcp/tools/` (`mod` + `compare`, `get_state` / `list_projects`),
`src/state/mcp/` (`dispatch`, `analyze`), `src-tauri/src/cli/batch/` (`compare`, `args`,
`types`, `mod`), `src-tauri/tauri.conf.json` (`compare` subcommand).

## Tests

- **Rust unit** — grid signature, series/spectrum/matrix delta, event pairing, scalar
  delta, mismatch list, and shaping; **M25.B** relative matching (non-overlapping
  windows, `bOffset` sign/limits, matrix null columns, waveform nearest-bucket) and
  **M25.C** `COMPARE` round-trip (including a spectrogram snapshot), unknown-section
  forward compatibility, saved-side resolution.
- **Rust integration** — `run_comparison` against two `WindowState`s (different sources
  and filters), reference resolution (root labels only), the peer reads, and a saved
  snapshot with only A open.
- **Unit (TS)** — dockview sanitiser (compare panels removed, empty groups pruned, an
  active compare group re-pointed), compare panel id parsing, the compare-panel
  derivation (the M25 regression where any panel add/remove dropped the reference), peer
  poll latest-wins, relative merge/clipping, the swap sign, marker mapping, and the
  picker's target/saved filtering.
- **E2E `r2-compare` / `r2b-compare-relative`** — two projects with distinct tones:
  Compare with… from Spectrum shows both series and the legend; B's cursor and B's
  playhead appear on the compare chart and follow B; a differing FFT size shows the badge
  and no delta; closing B shows the banner; retargeting reuses the tab. **M25.B**
  (`r2b-compare-relative`): adjacent windows compare from 0, the offset slider moves the
  common span, Swap moves the axis/clip, and an add/remove of another tab keeps the
  reference. **M25.C**: saving with a compare tab and reopening one project restores the
  compare tab with the **saved reference** badge and B's band; reconnect is explicit; a
  settled B change marks A dirty.
- **E2E compare views (M25.A, `r2-compare` / `r2b-compare-relative`)** — R2.7–R2.10:
  the matrix A/B/Δ switch and the no-interpolation case, event pairing (matched /
  only-A / only-B), the `noteMetrics` table's A/B/Δ rows, the modulation AM/FM toggle;
  R2.11–R2.12 (M25.B): the waveform overlays a differing window and says it is clipped to
  the common span, adjacent windows compare from 0, the δ slider moves the common span,
  Swap moves the axis/clipping, and the reference survives opening another tab.
- **E2E popout** — *Pop out to window* closes the compare tab and shows a window titled
  `Compare: Spectrum — <B>` with the same overlay; B's cursor/playhead still follow; A's
  hover in the popout moves A's cursor in the project window; closing the popout forgets
  the window. A saved comparison restores as a **tab**, never as a popout window.
- **MCP** — `compare_analysis` with `target`/`with`/`bOffset`/`saved`, compact/full/
  summary, an unknown reference, a matrix tool (core diff without a view), a live-project
  call, a saved snapshot, and (M25.D) a headless file-reference call that is then saved
  into `COMPARE`.
- **CLI** — `compare a.heyl b.heyl -t spectrum --summary`, `--b-offset`, `--overlap`,
  mismatch, a reference project, a missing `filterSpec` warning, and the exit codes.
- **M25.A** — the view helpers: Δ limit/span, identical windows and bucket times,
  event-pairing summary, note-table rows, and one E2E per added family (see above).

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

M25 made the common charts usable and every tool scriptable; M25.A completes the visual
matrix, so every analyzer compares in the view as well as through MCP/CLI.

**M25.B** (relative alignment)

5. Core: relative matching, `bOffset`, `alignment` in `comparability`, matrix nulls,
   waveform nearest-bucket, then MCP/CLI `bOffset` and the Rust tests.
6. Frontend: the relative axis, the offset slider, swap-aware extent/clipping, marker
   remapping, the sync transform, the compare-panel derivation fix, then the E2E/unit
   pass.

**M25.C** (saved comparisons)

7. Project: the `COMPARE` section + postcard wrapper, `save_project` / `load_project`,
   the saved-side resolution in the core, and the round-trip tests.
8. Frontend: saved-reference binding, picker entry + same-name hint, restore-as-tab,
   the dirty signature, then the E2E/docs pass.

> **Decision:** in M25 comparisons were transient cross-project views computed by the core,
> not a second track and not project content (ADR-24). **M25.B** supersedes the absolute
> overlap rule (ADR-26) and **M25.C** saves the comparison as a reference snapshot
> (ADR-27). The compare *panel* still never goes into `LAYOUT`.

> **Delivered (M25).** The contract above is implemented end to end. Notes
> from delivery:
>
> - `aligned` is `mismatches.is_empty()` **and** (for series/events/notes) an overlap.
>   A mismatch therefore suppresses the delta for **every** family, including a scalar
>   readout — a readout comparison is numeric only when rate, channel and the tool's
>   grid options agree.
> - `filtersDiffer` is reported but does not suppress the delta: each side runs with
>   its own filter, as processed.
> - The two runs execute sequentially on the blocking pool.
> - The compare tab starts as `Compare: <Tool>`; its title gains the two project names
>   when the first comparison resolves.
> - The reference picker is a modal dialog (tab menu → *Compare with…*, Analysis menu →
>   *Compare with…*), and the header carries a reference select for retargeting.
> - A compare popout's window label is `compare-<n>`; it is registered with
>   `(tool, reference)` and never appears in `popout_tools_of`.
> - `LAYOUT.filterSpec` is written on save whenever a filter is applied; the CLI falls
>   back to an unfiltered comparison (with a stderr warning) when it is absent.

> **Delivered (M25.A).** Every family now has a compare view, and *Compare with…* is
> offered for every analyzer. Notes from delivery:
>
> - **Matrix / spectrogram** is read-only: the plain-canvas heatmap has no zoom or note
>   lane (so it does not join a sync group), and follows the union of the two analysis
>   windows. A and B share one colour range (so switching sides never rescales); the Δ
>   image is symmetric around its largest absolute value and uses a diverging ramp sampled
>   from the theme (`compareA` → background → `compareB`). A differing grid shows both
>   heatmaps side by side.
> - **Rhythm** marks the **core's** pairings (A above the midpoint, B below, matched
>   pairs linked, one-sided events dashed over the full height), so the chart and the
>   MCP/CLI summaries always agree.
> - **`noteMetrics`** uses the core's note pairs for both the paired blocks and the
>   table; a note only one side has is still a row. Its canvas is read-only like the
>   heatmaps.
> - **Modulation** has an **AM / FM** toggle (one line per side) and joins the `"mod"`
>   sync group; B's cursor is a rate-axis rule.
> - **Waveform** overlays the peak envelopes only when the core produced an envelope
>   delta (`buckets > 0`, i.e. identical windows); otherwise it draws each side's min/max
>   envelope separately and says why. (M25.B replaces this with the clipped-common-span
>   rule; side-by-side remains only for a differing grid.)
> - `peerPlugins` draws playheads only on time-axis charts: a source-second playhead on a
>   frequency or rate axis was meaningless (and wrong).
>
> Deviations kept explicit: the matrix view does not zoom (the other families keep their
> normal zoom / sync); the Δ heatmap's limit is the largest absolute Δ rather than a
> percentile.

> **Delivered (M25.B) — relative alignment.** Replaces the absolute overlap rule:
>
> - both sides use `x = t − result.windowStart`; the axis extent is the **displayed A**
>   side's duration, and `Swap A/B` swaps the extent, clipping and offset sign;
> - a fine-tune **δ slider** (±1 s, 1 ms steps, 0 default, positive = B later) moves
>   displayed B without re-analyzing; the comparison re-runs debounced;
> - the Δ/pairings/matrix cover the **common span** `[max(0, δ), min(durA, δ + durB)]`;
> - matrix frames with no counterpart become **null** columns; the waveform delta samples
>   the neighbour envelope at A's bucket times (nearest within one bucket);
> - markers are remapped and the sync group converts absolute ↔ relative at the boundary;
> - `run_comparison` gains `bOffset`, `comparability` gains `alignment`, MCP/CLI expose it;
> - fixes the M25 regression where `views.ts` read compare tabs from `openTools` (which
>   excludes them), dropping the reference on any panel add/remove and leaving
>   `get_state.compare` empty.

> **Delivered (M25.C) — saved comparisons.** Replaces the "not project content" rule:
>
> - a `COMPARE` section (id `0x08`, `postcard`) holds one snapshot per comparison open at
>   save time: tool, reference **name**, the reference's **project file** (so the view's
>   **Open reference** button reopens it exactly), source shape, window, params, effective
>   options, filter fingerprint, B's full last `AnalysisResult`, `bOffset`, `savedMs` — no
>   B audio;
> - saved comparisons restore as **tabs** (never popouts); they bind to the snapshot until
>   an explicit reconnect (the picker hints a same-named open project);
> - a saved reference hides B's live markers and marks the badge/banner **saved
>   reference**;
> - a settled change in live B is part of A's dirty signature while the view is open;
>   snapshots stay out of undo/redo; closing the tab and saving drops the snapshot;
> - MCP `compare_analysis` accepts `saved: true`; `get_state.compare` reports
>   `{ tool, with, saved, offset }`; `list_projects` reports saved comparisons.
>
> Implementation notes and deviations, kept explicit:
>
> - The section payload uses a **postcard-safe mirror** of the result
>   (`results::StoredAnalysisResult`, an externally tagged enum with one newtype variant
>   per tool) instead of deriving `Deserialize` on the internally tagged IPC
>   `AnalysisResult`: postcard is not self-describing and cannot decode that
>   representation. The mirror's conversions are exhaustive, so a new tool is a compile
>   error until it is stored.
> - A payload that **skips** an absent optional key is stored through a positional
>   wrapper (`StoredSeries`, `StoredNoteMetrics`): `skip_serializing_if` only affects
>   writing, so postcard would omit a field the reader still expects and run off the end
>   of the buffer — which is what made a saved **series** (or grouped-notes) comparison
>   unreadable. The wrappers write every field unconditionally while the JSON wire keeps
>   its absent-key shape; the field order matches the structs, so a file written before
>   the wrapper (both optional keys present) still decodes.
> - The core keeps the **last successful** comparison per tool. Saving writes the
>   snapshots of the comparisons open at save time (tabs *and* popouts) and prunes the
>   rest; a comparison that never resolved has no snapshot. `savedMs` is refreshed when
>   the snapshot is recorded; the fingerprint ignores it.
> - `run_comparison` returns a `savedFingerprint` (FNV-1a over the postcard encoding of
>   the snapshot, excluding `savedMs`). The project's dirty signature includes each open
>   compare tab's `{binding, offset, fingerprint}` (`state/compare/views.ts`), so a
>   settled B change flags A — and restoring a saved comparison does not (the stored and
>   recomputed fingerprints are equal).
> - **Deviation:** dirty tracking covers open compare **tabs**. A compare **popout** is a
>   separate webview, so a settled B change made while only the popout is open updates the
>   core snapshot (and is written on save) but does not set the owner window's dirty flag.
> - The saved side's window and params come from the snapshot; the core runs **only A**.
>   `compare_live` is not polled for a saved binding (there is no live B), and the view
>   shows B's band from `alignment` + the snapshot's window.
> - The header's reference select lists live projects **and** the tool's saved snapshot
>   (`Saved: <name>`); choosing a live project resets `bOffset` to 0, choosing the snapshot
>   restores the saved offset. The picker offers the same entry with one window open.
