# E2E testing

End-to-end tests drive the **built** Hey Listen desktop app through the system
WebView (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) with
WebdriverIO + `@wdio/tauri-service`. They answer one question: **does every tool
and every core workflow actually work and stay usable?** They are *not* a
unit-test replacement — the Rust engines (`audio/*`) and the frontend state
modules keep their own cheap, focused tests.

## Stack

| Choice | Value | Why |
| --- | --- | --- |
| Runner | WebdriverIO + `@wdio/tauri-service` | The supported Tauri v2 stack; one suite on all three OSes. |
| Driver provider | `embedded` (`tauri-plugin-wdio-webdriver`) | Zero external driver; the only macOS route that needs no CrabNebula API key. |
| Frontend plugin | `@wdio/tauri-plugin` | `browser.tauri.execute()` for setup and IPC-affordance driving; the app's own `src/lib/ipc.ts` seam substitutes command results (see below). |
| Capability | `browserName: 'wry'`, `tauri:options.application` | Points the service at the release binary. |

The suite runs against the **release** binary (`npm run tauri build`);
`appBinaryPath` → `src-tauri/target/release/hey-listen`.

### Implemented (M8)

Delivered: `tauri-plugin-wdio` + `tauri-plugin-wdio-webdriver` in `lib.rs`, the
`wdio`/`wdio-webdriver` capabilities, `withGlobalTauri`, the `@wdio/tauri-plugin`
import, `wdio.conf.ts`, `e2e/{.fixtures,support,specs,artifacts}`, the `npm run test:e2e` and
`npm run typecheck:e2e` scripts, and the `e2e` CI job. Coverage: 17 spec files —
A shell (3), B sources (4), C graphs (8), D analyzers (27), E correctness (5), F
cross-cutting (6), G timeline (5), H open-audio (1), I errors (6), J project + popout (2),
K MCP (5), L MCP UI (5), M themes (4), N notes (4), O cross-window cursor (1),
P notes interactions (4), Q preview transport (6).

**IPC mocking.** `browser.tauri.mock()` cannot intercept this app's calls: the
plugin patches `window.__TAURI__.core.invoke`, but Tauri injects
`__TAURI_INTERNALS__` as non-writable/non-configurable and the app calls it through
the bundled `@tauri-apps/api`. So every command goes through `src/lib/ipc.ts`,
which exposes a test-only override (`globalThis.__heylisten_test__`); the helpers in
`e2e/support/helpers.ts` (`mockReturn` / `mockReject` / `restoreMocks`) install a
small mock table on it. The override is never installed in production, and
`restoreMocks` resets to the dialog defaults rather than to an empty table.

**Native dialogs are always mocked.** WebDriver can't interact with native
OS/Tauri modals — they block the webview and stall the run. So the helpers *always*
seed mocks for the dialog commands (`confirm` → true; `pick_audio_file` /
`pick_project_save_path` / `pick_project_open_path` → `null`), even before a spec
sets its own. A real dialog must never appear; if one does, a helper mock is missing.

**Artifacts.** `outputDir` is `e2e/artifacts` (gitignored): the service writes its
log there, WDIO writes one JSON per spec, and `onComplete` merges them into
`wdio-report.json`. CI uploads the directory as the `e2e-report-<os>` artifact.

**One app instance per run.** WebdriverIO launches the app once, so spec files share
it and carry state. Helpers account for that: `openFixture` is duration-aware (it
skips a reload when the same fixture is already loaded), each spec's `before`
`closeAllTabs()`, and a spec that opens a **secondary window** closes it in its own
`after` hook (`j-project` → H2, `o-cursor-sync`, `r-multi-project`) — through the app's
own `close_window`, because a leftover window leaves the session pointed at it and the
next spec's calls then fail against it. (`t-close-main` is the exception: it is last, and
leaves one project window open so the app does not exit before teardown.) Because the dialogs are
stubbed through the app's own IPC seam, a spec that loads a file should install its own
stubs (`openFixture` does) rather than inherit them from whichever file ran first — a
suite file has to stand alone for a targeted `--spec` run to mean anything.

**Dockview unmounts hidden panels.** The default renderer keeps only the active
tab mounted, so a test that reads a chart must activate its tab (`activateTab`).

**Synthesized pointer/drag events.** The system WebView doesn't produce W3C pointer
actions (or native HTML5 drag-and-drop) under WebDriver, so `pointerDrag` (timeline
handles, splitter) and `dragPaletteNode` (graph palette) dispatch the app's **real**
`pointer*` handlers directly — the same UI path, just driven by events the harness
can emit. (The palette drag is pointer-based, not HTML5 drag-and-drop, because
Tauri's native file-drop handler consumes HTML5 drags over the WebView.) A dropped
**file** is driven by emitting the same native window event the handler listens for:
`emitEvent("tauri://drag-drop", { type: "drop", paths: [path], position })`.

## Deliverables (this milestone)

1. Add `tauri-plugin-wdio-webdriver = "1"` to `src-tauri/Cargo.toml` and register
   it in `src-tauri/src/lib.rs` (`tauri::Builder::default().plugin(tauri_plugin_wdio_webdriver::init())`).
2. Add dev deps `@wdio/tauri-service` and `@wdio/tauri-plugin`.
3. `wdio.conf.ts` at the repo root with the `embedded` provider + `'wry'` capability.
4. `e2e/` directory — `.fixtures/` (generated, gitignored audio), `specs/`,
   `support/` (selectors + helpers), `artifacts/` (gitignored report + logs).
5. `npm run test:e2e` script.
6. GitHub Actions job that builds the app and runs the suite on the platform matrix.

## Fixtures

Deterministic, generated on the fly (no audio blobs committed) so every run is
reproducible. `wdio.conf.ts`'s `onPrepare` writes them to the gitignored
`e2e/.fixtures/` before the app launches:

| Fixture | Content | Exercises |
| --- | --- | --- |
| `sine440` | 2 s, 48 kHz mono, 440 Hz at −12 dBFS, short fade in/out | waveform, spectrum peak, pitch ≈ 440, level meters, loudness |
| `chirp_noise` | 3 s, 20 Hz→8 kHz log sweep + noise burst at 1.5 s | spectrogram, mel, MFCC, chroma, spectral-shape tools, onsets, tempo, downbeats |
| `stereo` | 2.5 s, 48 kHz stereo, 440 Hz left / 880 Hz right | the channel-select scenario (G3) |
| `corrupt` | a RIFF header followed by garbage | the real `probe_file` error path (I1) |
| synth graph | deterministic `sine(440) → output`, rendered via `render_synth` | the synth source path |

`sine440` gives the correctness spot-checks a known, assertable value; `chirp_noise`
gives every spectral/rhythm tool a real, non-flat signal.

## Selectors

Tests select by stable `data-testid` plus the existing ARIA labels (the search box
already carries `aria-label="Search analyzers"`). This milestone adds `data-testid`
hooks only where a test needs one — a thin, test-only attribute, not a refactor.
Convention: `data-testid="region.toolbar|sidebar|workbench|timeline|source|bottom"`
(regions), `toolbar.filter` (the Filter switch in the **Timeline** toolbar),
`toolbar.error`, `toolbar.preview.error` (a preview that could not start),
`sidebar.search`,
`sidebar.tool.<id>`, `tab.<id>` (stamped on the dockview tab), `analyzer.<id>`,
`analyzer.error`, `analyzer.params.<id>` / `analyzer.about.<id>`, `graph.error`,
`graph.warning` (the persistent **Output is not connected** banner),
`graph.connection.warning` (the transient rejected-connection banner), `graph.render`,
`graph.clear`, `graph.hint` (the node/link toolbar hint), `graph.node` (a node, also
carrying `data-kind`) / `graphNode(kind)`, `graph.port` (a port label),
`graph.palette.btn` (a palette button), `source.openFile`, `source.kind`,
`source.error`, `timeline.canvas`, `timeline.replace`, `toolbar.about` (the About
button), `about.dialog`. All live in
`e2e/support/selectors.ts`.

**Icon-only controls carry `aria-label`.** Most toolbar / timeline / graph / source
buttons are now icon-only (with a tooltip); they keep their `data-testid`, and the
ones without one are addressed by `aria-label` (e.g. `[aria-label="Dark mode"]`,
`[aria-label="Output device"]`). The tooltip itself is a `Tooltip` component
(`src/components/Tooltip.tsx`), not a native `title`, so it is not queried by tests.

`tab.<id>` is **stamped by the app** (`Workbench.tsx` → `scheduleStampTabIds`):
dockview gives tabs no stable hook of their own, so we match each `.dv-tab` to its
panel by title. The stamping deliberately does **not** use `requestAnimationFrame` —
WebKit throttles (and can pause) animation frames while the window is occluded, which
is the norm on headless CI (macOS runners, Linux `xvfb`), and would leave every tab
unstamped and every tab-addressing test failing. It retries on a short `setTimeout`
instead, which still fires when occluded.

The graph *interaction* tests (C5–C8) use those hooks — `graph.node` + `data-kind` to
find a node by kind, `graph.port` for port labels, `graph.palette.btn` for the palette,
and `graph.hint`'s counts to assert node/link changes (edges are never queried from the
SVG DOM).

## Test matrix

The suite is deliberately **not exhaustive**. One parametrized smoke test drives
every tool; five correctness spot-checks verify the math is actually right; the
scenario tests verify the app is usable end-to-end. Anything not in a box below is
intentionally untested.

**Legend** — **Smoke** (opens/renders, asserts non-empty result + no error),
**Correct** (asserts a concrete value on a known fixture), **Scenario** (asserts a
whole workflow), **Manual** (documented steps, run by a human, not in CI).

### A. Shell & layout

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| A1 | Fixed regions render | Timeline, Sidebar, Source, Workbench all present and not tabbed | Smoke |
| A2 | Row splitter | Drag the splitter; bottom row height changes and clamps | Smoke |
| A3 | Output gain/device + meter | Gain readout updates; device list populates; output meter moves during preview | Smoke |

### B. Source kinds

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| B1 | File source | `pick_audio_file` → `probe_file` → `stream_file`; timeline waveform renders, window defaults to full length | Scenario |
| B2 | Synth source | Build synth graph → `render_synth`; timeline waveform renders from the PCM | Scenario |
| B3 | Switch source | Open file then synth; the timeline is replaced (one source per project) | Scenario |
| B4 | Capture error | Start mic/system capture without a grant; surfaces an **error**, not silence | Scenario |
| B5 | Live capture | With a grant, record; input meter live, timeline grows, pause/resume | Manual |

> Capture is the one area macOS can't fully automate: the TCC prompt only appears
> for a **bundled + signed** app and CI can't answer it. So the error path (B4) is
> the automated test; the granted happy path (B5) is a short manual smoke (bundle →
> grant → record → verify). See `source-model.md` → OS permissions for the
> `tccutil` reset commands.

### C. Graph editors

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| C1 | Filter graph | Build `input → lowpass → output`; graph compiles and is shown | Scenario |
| C2 | Filter bypass | The Timeline toolbar's **Filter** switch reads off on the identity seed; composing a node turns it on; toggling bypasses it (preview/analysis reflect on/off); enabling with an empty graph opens the filter view | Scenario |
| C3 | Synth graph | `sine → output`, render; PCM lands on the timeline (B2) | Scenario |
| C4 | Graph rules | A second edge into an occupied input / a cycle is rejected with a warning, no crash | Smoke |
| C5 | Math nodes | The **Math** group (`add`/`subtract`/`multiply`/`divide`/`min`/`max`/`abs`/`invert`) is offered in the palette; a `multiply` graph compiles in the core | Smoke |
| C6 | Port labels | Nodes render tiny input/output labels (`in`/`out`; `A`/`B` on a binary node; `L`/`R`, `audio`/`cut`/`Q`… on multi-port kinds) | Smoke |
| C7 | Palette drag | Dragging a palette node onto empty canvas lands it centred where released, without touching any edge | Scenario |
| C8 | Drop to splice | Dropping a node onto a connector splits `source → target` into `source → node → target` and compiles | Scenario |

### D. Analyzer tools — every tool

One parametrized smoke test iterates over all 26 tool ids and, for each: opens the
tab from the Sidebar, waits for the result view to render non-empty, opens the
**about** and **params** popovers, re-clicks to confirm **no duplicate tab**, then
closes. This is what "cover every tool" means — a single, data-driven test, not 26
copies. The ids and view kinds come from `src/state/analyzer/`:

| Tool | id | View | Smoke asserts |
| --- | --- | --- | --- |
| Waveform | `waveform` | waveform | envelope canvas non-empty |
| Level meters | `levels` | readouts | peak/RMS readouts present |
| Spectrum | `spectrum` | spectrum | curve rendered |
| Spectrogram | `spectrogram` | spectrogram | heatmap canvas non-empty |
| Mel spectrogram | `melSpectrogram` | matrix | matrix cells non-empty |
| MFCC | `mfcc` | matrix | matrix cells non-empty |
| Chromagram | `chromagram` | matrix | matrix cells non-empty |
| Spectral centroid | `spectralCentroid` | series | series line rendered |
| Spectral flux | `spectralFlux` | series | series line rendered |
| Spectral rolloff | `spectralRolloff` | series | series line rendered |
| Spectral flatness | `spectralFlatness` | series | series line rendered |
| Spectral contrast | `spectralContrast` | matrix | matrix cells non-empty |
| Spectral bandwidth | `spectralBandwidth` | series | series line rendered |
| Spectral entropy | `spectralEntropy` | series | series line rendered |
| Spectral crest factor | `spectralCrest` | series | series line rendered |
| Harmonic ratio | `harmonicRatio` | series | series line rendered |
| Zero-crossing rate | `zeroCrossingRate` | series | series line rendered |
| Pitch (pYIN) | `pitchPyin` | series | pitch track rendered |
| Pitch (YIN) | `pitchYin` | series | pitch track rendered |
| Pitch (autocorr) | `pitchAutocorr` | series | pitch track rendered |
| Tempo | `tempo` | readouts | BPM + confidence readouts |
| Onsets | `onsets` | events | onset markers rendered |
| Downbeats | `downbeats` | events | downbeat markers rendered |
| Integrated LUFS | `loudnessIntegrated` | readouts | LUFS readout present |
| Loudness (momentary) | `loudnessMomentary` | series | loudness series rendered |
| Loudness range | `loudnessRange` | readouts | LRA readout present |

### E. Analyzer correctness spot-checks

On the `sine440` fixture, assert the tools actually **measure** — not just render.
One representative per computation family:

| # | Tool | Assertion (tolerance) | Family |
| --- | --- | --- | --- |
| E1 | `spectrum` | peak bin ≈ 440 Hz (± one bin) | STFT |
| E2 | `pitchPyin` | median f0 ≈ 440 Hz (± 2%) | pitch |
| E3 | `levels` | peak ≈ −12 dBFS (± 0.5 dB) | level/loudness |
| E4 | `loudnessIntegrated` | LUFS value finite and ≈ expected (± 2 LU) | level/loudness |
| E5 | `tempo` (on `chirp_noise`) | BPM finite and within 40–240 | tempo/rhythm |

The remaining tools are trusted through the parametrized smoke test.

### F. Cross-cutting analyzer behavior

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| F1 | Search | Type in the Sidebar search box; list filters by title/keywords; graph editors stay visible | Scenario |
| F2 | No duplicates | Open a tool twice; one tab, existing tab focused | Scenario |
| F3 | Shared params | Change FFT size / channel / freq range; `run_analysis` re-fires, all open tools agree | Scenario |
| F4 | Zoom/cursor sync | Zoom one time chart (the visible range actually narrows); x-zoom mirrors across the time-group tabs | Scenario |
| F5 | Popovers | Params + about popovers render per-tool config/copy | Smoke |
| F6 | Zoom persistence | Zoom a chart, then change the shared FFT size (an analysis re-run); the zoom survives (used to snap back to the full window) | Scenario |

### G. Timeline

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| G1 | Window range | Drag start/end handles; preview plays, the settled window re-runs analysis | Scenario |
| G2 | Zoom | Zoom a short window; waveform re-renders at higher detail | Smoke |
| G3 | Channel select | Pick L/R/mix on a stereo file; waveform + analyzers agree | Scenario |
| G4 | Window move re-fits the charts | Zoom a heatmap in, move the analysis window: the chart re-fits to the whole *new* window (the same range the Fit control gives) instead of keeping a stale slice | Scenario |
| G5 | A drag coalesces its pushes | A 20-move handle drag in one gesture moves the window and pushes the shared state a handful of times, not once per move | Scenario |

### H. Project file (M6) & multi-window (M7)

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| H0 | Open audio from the OS | Emit the file-association channel (`app:open-project`) with an audio path; it opens as a **fresh project** named after the file, with the audio on the timeline | Scenario |
| H1 | Save/load | `save_project` → `load_project`; source + setup + results round-trip | Scenario |
| H2 | Popout | Right-click a tab → **Pop out to window**; a native window shows just that tool, titled `<tool> — <project>`; selecting it in the Sidebar raises the popout (no duplicate tab); timeline/params/zoom sync; it closes with its parent and reopens on project load | Scenario |
| H3 | Closed popout returns a tab | Closing the popout window forgets the tool in the core (`popout_tools`); selecting it in the Sidebar then opens a **tab**, not a dead window | Scenario |

> **H2 leaves one window behind.** One app instance is reused across spec files, so a
> `popout-*` window that survives makes the *next* spec's `execute/sync` calls time out
> (it looks like a wedged app — this cost K a 30 s script timeout per call). H2 therefore
> closes the popout it opens in the spec's `after` hook, through the app's own
> `close_window` command (the frontend's `onCloseRequested` guard blocks a native close).

### I. Errors & warnings

One case per UI surface: force the condition, assert the message appears in the
right place, and assert the app stays usable (no crash; the region recovers). The
capture error (B4) and the graph connection warning (C4) complete the picture.

| # | Surface | Trigger | Asserts | Kind |
| --- | --- | --- | --- | --- |
| I1 | Toolbar (source) | Open an invalid/corrupt file; real `probe_file` fails | Red `app-status-error` shows the message; timeline stays empty; a valid file recovers | Scenario |
| I2 | Analyzer tab | Mock `run_analysis` to reject | Red `analyzer-error` shows the message; tab stays open, no crash | Scenario |
| I3 | Filter graph tab | Mock `set_filter_graph` to reject | Red `graph-error` shows the message; Filter bypass toggle still works | Scenario |
| I4 | Synth graph tab | Mock `render_synth` to reject | Red `graph-error` shows the message; Render button re-enables | Scenario |
| I5 | Graph tabs (warning) | Disconnect the `output` node | Persistent `graph-warn` "Output is not connected…" shows, then clears once rewired | Scenario |
| I6 | Toolbar (preview) | Mock `preview_region` to reject | Red `toolbar.preview.error` names the failure; the transport does not look alive; a successful retry clears it | Scenario |

### K. MCP server (M9)

Speaks MCP to the app's loopback endpoint directly from Node (no bridge), driving
the **running** app. Exercises the protocol, real tool execution, and UI following.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| K1 | Handshake | `initialize` returns `serverInfo.name = hey-listen` and echoes the version; `tools/list` carries the catalog (`get_state`, `run_analysis`, …) | Smoke |
| K2 | Open a source | `open_audio_file` puts the fixture on the **live timeline**; `get_state` reports its shape | Scenario |
| K3 | Run analysis | `run_analysis` (spectrum) returns a result (~440 Hz peak) **and** opens the analyzer tab | Correctness |
| K4 | UI following | `open_tool` opens a Workbench tab in the main window | Scenario |

K enables MCP first (`set_mcp_config`, on a free port) — it is **off by default**.

### L. MCP control surface (M9 follow-up)

Drives the Toolbar **MCP** popover (a view over the core-owned settings) and asserts
the resulting server state.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| L1 | Popover content | The popover renders the toggle, port, and an `mcpServers` snippet | Smoke |
| L2 | Toggle + status | Turning MCP off reads "off"; turning it on shows `listening on 127.0.0.1:` | Scenario |
| L3 | Port input | Committing a port moves the endpoint to `127.0.0.1:<port>` | Scenario |
| L4 | Busy port | A port held by the test process falls back to a free one with an inline note | Scenario |
| L5 | Copy | The Copy button confirms (best-effort on headless CI) and the panel survives | Smoke |

> **Headless CLI (Rust):** `src-tauri/tests/headless_mcp.rs` spawns the real
> `heylisten-mcp --headless` binary and drives `initialize → tools/list →
> open_audio_file → run_analysis → open_tool` over its stdio (run by `cargo test`).
> It is not part of the wdio suite (no webview).
>
> **Batch CLI (Rust, M10):** the command's work is a plain function over a request
> struct, so `cargo test` covers it with no Tauri app and no display — the `spectrum`
> peak over a generated WAV, the JSONL line count for a two-file batch, and the exit
> code for an unknown tool; the `Matches` → request mapping is unit-tested with
> synthetic `Matches`. The end-to-end `hey-listen analyze …` invocation needs the
> platform event loop (a display), like the app and the `--mcp` path, so it is verified
> by hand rather than in the wdio suite. See [`cli.md`](cli.md).

### M. Exchangeable themes (M11)

Drives the Toolbar **Appearance** popover and asserts the resulting root palette +
`data-theme`, plus the persisted preference. The theme preference persists across
launches, so the spec resets to a known state first and restores the defaults after.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| M1 | Default look | After resetting, `data-theme = dark` and the retrowave `--bg` is applied | Scenario |
| M2 | Mode switch | `Light` applies the light base (`data-theme = light`, light `--bg`); `Dark` restores the retrowave palette | Scenario |
| M3 | Slot selection | Assigning Nord to the dark slot applies the nord `--bg`; restoring Retrowave Neon changes it back | Scenario |
| M4 | Persistence | Switching the mode writes `hey-listen:theme` in `localStorage`; the dark slot persists | Scenario |

> **Unit + store coverage (not wdio):** the `ThemeFile` parse/validate/normalise
> contract is checked by `npm run test:unit` (`scripts/themeFile.test.ts`), and the
> Rust store (`themes.rs`) is unit-tested by `cargo test` (id validation, bundled-id
> uniqueness). Import/export use native dialogs (mocked in the suite), so the file
> round-trip is exercised by hand rather than in the wdio suite.

### N. Notes (M14)

Drives the annotation layer end to end: add a note from the Notes rail (which captures
the focused chart's frozen values), confirm the row + values, save the project, discard
it, load it back and confirm the note survives, then delete it.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| N1 | Add from the rail | The rail opens from the Toolbar; `Add` creates a row whose frozen values line contains `peak` (from the focused spectrum chart); the count reads `1` | Scenario |
| N2 | Persistence | The note survives `save_project` → `new_project` → `load_project` | Scenario |
| N3 | Own window | The row's popout action opens a `note-*` Tauri window showing just that note's editor; saving there commits and closes it, and the rail shows the new heading | Scenario |
| N4 | Delete | The row's delete button removes the note (the empty state returns) | Scenario |

### O. Cross-window cursor sync (M14 follow-up)

A second window is a view of the same project, so the shared cursor rides `uiState`. One
window holds a canvas heatmap and the other a uPlot chart, so both painter paths are
covered.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| O1 | Cursor mirror | Hovering either window's chart repaints the other window's chart (the Timeline mirror proves the publish; the uPlot plugin and the canvas renderer are the two painters), and a **second** remote move keeps following — a watcher that tracked only the message tag froze the mirror after the first position | Scenario |

> **Sampling a dashed rule.** The mirrored cursor is dashed (`[4, 4]`), and a dash's on/off
> phase is fixed relative to the plot, so reading a **single** row of pixels can sit in a gap
> at *every* position and report "nothing moved" — a false negative that cost a whole
> debugging session. `rowSignature` (`e2e/support/analyzers.ts`) therefore reads a **band** of
> eight consecutive rows, which always covers a dash cycle.
>
> **The local cursor is a DOM element.** uPlot 1.6.32 draws its *native* crosshair as
> `.u-cursor-x` / `.u-cursor-y` divs positioned with a transform, not on the canvas — so the
> hovered chart's own repaint is asserted on that element's transform, while the *mirrored*
> cursor (a canvas rule) is asserted with `canvasSignature` / `rowSignature`. Asserting the
> local repaint on canvas pixels only ever passed because a leaked `ui-state` echo drew a
> mirror rule onto the hovered chart (the scoping bug described under R).

> **Also covered:** the tool-param **switch** interaction (a click on Kobalte's control
> toggles exactly once and repaints the chart) is an extra case in `d-analyzers.spec.ts`,
> and `scripts/previewSpeed.test.ts` unit-checks the varispeed slider's log scale.

### P. Notes — the interaction model (M14 follow-up)

What the flow spec (`n-notes`) leaves out: what creating, selecting and analyzing a note
do to the analysis window, closing the rail, the Timeline lane gesture, and the **matrix**
tools where note creation used to throw.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| P1 | Create / select ≠ reframe | `Add` opens the editor (keeping the frozen values line) and neither it nor selecting the row moves the analysis window | Scenario |
| P2 | Analyze reframes | The row's `Analyze` is the only action that moves the window onto the note (a range becomes it) | Scenario |
| P3 | Closing the rail | Closing unfocuses the note and the Toolbar button carries the count | Scenario |
| P4 | Matrix tools | A note is created on the mel spectrogram — the regression where a `MatrixResult` (which carries `times` *and* `bins`) was classified as a series and threw | Scenario |

### Q. Preview transport (M14 follow-up)

The Timeline's transport: the **varispeed** slider, the **playhead** a preview paints on
the open charts, the **note-at-the-playhead** action, the Timeline scrollbar, and the
looped region **following the analysis window** when it moves. Audio cannot be heard
headlessly and WebKit suspends `requestAnimationFrame` (and throttles timers) for the
window WebDriver drives, so the transport advances in coarse steps and the assertions are
what it *drives* — not frame-by-frame smoothness. The playhead cases stub
`preview_region` through the IPC seam: the runners have no audio output device, so the
real command rejects with `NoDevice` (which correctly stops the preview and surfaces in
the toolbar's `toolbar.preview.error`, see I6), while the transport clock, the playhead
and the note time are all frontend-side.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| Q1 | Speed scale | The slider is logarithmic with 1× at the centre (ten arrow steps read 1.15×, a linear track would read 1.10×) | Scenario |
| Q2 | uPlot playhead | Starting the transport paints the rule on a uPlot chart's canvas and stopping erases it | Scenario |
| Q3 | Note at the playhead | With the window moved off the source start, the transport's button drops a note at the transport's position | Scenario |
| Q4 | Timeline scrollbar | Zooming the Timeline view reveals a scroll thumb | Smoke |
| Q5 | Heatmap playhead | The same rule appears on a canvas heatmap (the other painter path) | Scenario |
| Q6 | Preview follows the window | Moving the whole window while previewing reloads `preview_region` **once** at the settle, with the *new* window (not the stale region, and not per pointer move) | Scenario |

> **Unit + store coverage (not wdio):** the pure note helpers (clamping, labels,
> excerpts, the window-frame lookup `noteFrameAt`, and the snapshot comparison) are
> checked by `npm run test:unit` (`scripts/notes.test.ts`), and the `NOTES` section is
> round-trip tested by `cargo test` (the `project` module — a point note with values
> and a range note) and the batch CLI's `notes` subcommand (`cli::batch`). The engine's
> source-second re-basing is asserted by `cargo test`
> (`mcp::dispatch::tests::analysis_times_are_rebased_onto_source_seconds`), and the
> Timeline scrollbar's clamping / thumb geometry by
> `scripts/timelineScroll.test.ts` (`npm run test:unit`).

### R. Two projects at once (M7 multi-window)

One window = one project (ADR-3), so H1/H2 only ever exercise a *single* project: H1 replaces
the source within one window, H2 pops a tab out of the one window. This spec is the
cross-window angle — two project windows, each with its own audio, its own analysis, and its
own popout.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| R1 | Independent projects | A second window (`open_project_window`) keeps its own source (the 0:02 tone vs the 0:03 chirp) and analyses it against its own core state; going back and forth disturbs neither window's timeline nor its chart | Scenario |
| R2 | A popout per project | Popping the *same* tool out of both projects yields two popouts, each a view of its own project: different charts at the same params, and each titled after its own project (`Spectrum — <source>`) | Scenario |
| R3 | Raise is per project | Selecting the popped-out tool in one project raises *that* project's popout and opens no duplicate tab; the other project's Workbench is untouched | Scenario |
| R4 | Shared params stay in their project | Changing the shared FFT size in one project updates that project's own popout (a view of the same state) and leaves the other project's popout, showing the same tool, on its old size | Scenario |
| R5 | Save/load isolation | A project is saved in one window while the other is dirty, then that file is loaded into the dirty window: the loaded window adopts the name/source, the other keeps its own name, dirty marker and audio | Scenario |
| R6 | Popouts reconcile on load | The loaded project's layout records a tool that is **already** popped out (kept, not duplicated), while another tool that the window has popped out is **not** in the loaded layout (closed) | Scenario |
| R7 | Closing a project | Closing one project window destroys its own popout and leaves the other project's popout alive | Scenario |

> **R and S own the windows they open.** R closes every window it created in its `after`
> hook (popouts first, then the project windows). S is the suite's last spec because it
> closes `main`, whose label comes from `tauri.conf.json` and cannot be recreated.
>
> **R4/R5 guard a fixed bug.** Both used to fail: a `ui-state` patch was delivered to
> **every** window, because Tauri matches a listener's own target *before* applying the
> emit filter (`match_any_or_filter`, `tauri/src/event/listener.rs`) and
> `listen("ui-state")` used the default `Any` target — so `emit_to(label, …)` did not scope.
> A shared param or project title changed in one project reached the other project's
> frontend, which pushed it back into its own core state; `app:menu` had the same problem.
> The fix is two-sided: window-scoped listeners now go through `listenThisWindow`
> (`src/lib/windowEvents.ts`, an explicit `WebviewWindow { label }` target) and the two
> global emits (`Open Recent`, capture status) use `emit_to`. Changing only the emit side
> would not have been enough.
>
> **Popouts reconcile in one command.** A load (and New Project) calls `sync_popouts`, which
> closes the windows the project no longer records — duplicates included — and opens the
> recorded ones that are missing (`src-tauri/src/commands/window.rs`).
> `open_popout_window` is itself idempotent (it raises an existing window), so no path can
> create two windows for one tool.
>
> **Two harness rules it depends on.** `browser.tauri.switchWindow(label)` moves the *standard*
> WebDriver context with it — for the embedded provider the service calls
> `browser.switchToWindow(label)` and the label *is* the handle — so the existing DOM helpers
> keep working in the window switched to. But a window is listed **before** its webview has
> booted, so a switch to a just-created window is followed by `waitForShell()`. And a fresh
> webview has the test seam but **no installed IPC override**, so each newly entered window
> installs its dialog mocks first (`e2e/support/ipc.ts`).
>
> **Closing the window the session is sitting in** leaves the service pinned to a dead window
> label, and every `tauri.execute` (including `listWindows()`) then rejects until the session
> points at a live label. `windowLabels()` therefore falls back to plain WebDriver window
> handles for exactly this case.

### S. Project UX

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| S1 | Empty project | Opening a tab marks the layout dirty, but replacing a project with no source and pristine graphs raises **no** discard prompt | Scenario |
| S2 | Drop a project | Dropping a `.heyl` file loads that project (through the same discard guard as File → Open), while an audio drop still replaces the source | Scenario |
| S3 | Filter switch | It lives in the Timeline toolbar, reads off on the identity seed, enabling with an empty graph opens the filter view, composing a node turns it on, and clearing the graph turns it off again | Scenario |

### T. Closing the main window (M7 multi-window)

`main` is a project window like any other, so closing it must close its own popouts and
leave the other project alone. This is the suite's **last** spec: `main`'s label comes from
`tauri.conf.json` and cannot be recreated, and the app exits when the last window closes —
so the spec leaves one project window open instead of tearing that one down too.

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| T1 | Close main | With two projects each holding a popout, closing `main` destroys main's popout, keeps the other project **and its popout** alive (which still renders a chart), and the app stays up | Scenario |

## Running

```sh
npm run test:unit             # pure-helper unit checks (theme model + notes; no app needed)
npm run tauri build          # release binary
npm run test:e2e             # run wdio against the binary
npm run typecheck:e2e        # type-check the suite (no app needed)
```

Each run writes `e2e/artifacts/wdio-report.json` (plus per-spec JSON and the
service log).

### Rendering the UI without the app

For pure layout / CSS / component iteration, **`preview.html`** (repo root) renders the
real shell in a plain browser — no Tauri, no Rust core — so it can be inspected and
screenshotted without launching the app. It stubs the minimal Tauri internals
(`window.__TAURI_INTERNALS__`) so `src/index.tsx` boots instead of throwing; every
`invoke(...)` resolves to `null`, so there is no audio source or analysis data (the
Timeline is empty and analyzers show their empty state). Set a fake source from the
console if a view needs one:

```js
const m = await import("/src/state/source.ts");
m.finalizeSource({ name: "preview", detail: "preview",
  samples: new Float32Array(48000), sampleRate: 48000, channels: 1 });
```

```sh
npm run dev      # then open http://localhost:1420/preview.html
```

`vite build` builds only `index.html`, so `preview.html` is never bundled or shipped.

### Marketing screenshots

`npm run screenshots` (`screenshots.wdio.conf.ts` → `e2e/screenshots/capture.spec.ts`)
drives the **release** binary through the same embedded WebDriver `test:e2e` uses and
writes the marketing page's PNGs into `site/assets/`: `hero.png` (the whole window — the
Workbench grid with the notes rail open), `pitch.png` (the Pitch (autocorrelation)
popout window), and the `spectrum.png` / `tempo.png` / `filter.png` details. It lives
outside `e2e/specs/` on purpose, so CI never runs it: it is a manual, GUI-only task (it
launches a window and plays a moment of audio).

The shots come from a **project file**, not a scripted sequence of calls: the spec opens
`PROJECT` — a `.heyl` that carries the source audio (the PCM is embedded), the Workbench
**grid**, the band-pass filter, the analysis window and the notes — and captures what it
restores. That file is deliberately *not* in the repo, so a fresh clone has to point
`PROJECT` at its own project to recapture. Two things bite here:

- **A split layout cannot be scripted.** `openTool` adds every new tab to the focused
group, so the grid only exists in a restored layout.
- **Re-apply the filter after the restored popout boots.** Loading a project puts the
graph back in the editor, but the *analysis* does not pick it up until the graph is
pushed to the core again (the popout window boots its own copy and lands it in the shared
core after the project's own), so the spec calls `set_filter_graph` once the popout is up.

### When the shell does not render

A first paint that never happens is the hardest E2E failure to read: the app process and
its WebDriver server can be perfectly healthy while the window is empty. Two things make
it diagnosable instead of a bare timeout:

- **The app reports its own startup failures.** `src/boot.ts` is the app's first import,
  so it installs `error` / `unhandledrejection` handlers before any other module is
  evaluated (a module that throws while *loading* can only be caught by a handler that is
  already installed). Failures go to the webview console *and* to the Tauri log — the
  frontend's `console.*` is **not** forwarded to the log file by itself: `attachConsole()`
  mirrors *Rust* logs into the console, the opposite direction. First paint is also never
  gated on a single command: `popout_tool` has a 2 s fallback that renders the project
  window (and reports) rather than showing nothing.
- **The suite says what it saw.** A failing `waitForApp` appends a `window:` dump
  (`href`, `readyState`, `#root` child count, every `data-testid` currently in the DOM,
  and the body's first 600 characters), which separates "nothing mounted" from "mounted
  part-way".
- **A `C` locale must not blank the shell.** Headless runners and minimal containers
  default to a `C`/`C.UTF-8` locale, which makes the WebView report a non-BCP-47
  `navigator.language` (e.g. `"C"`). uPlot builds an `Intl.NumberFormat` at **module
  scope**, and `new Intl.NumberFormat("C")` throws a `RangeError`, which aborts the whole
  bundle before the first paint — an empty `#root` that looks exactly like a slow one.
  `boot.ts` (again, the app's first import) normalizes `language` to `en-US` when `Intl`
  rejects it, so the Ubuntu CI job — which runs under the default `C` locale — exercises
  this path.

Before it launches the app, the suite **kills any stale Hey Listen instance** (whatever
holds the embedded driver's port `4445`, plus any leftover `hey-listen` process) and
waits for the port to be released. The embedded driver binds a **fixed** port, so a
survivor from a crashed or manual run would otherwise be silently reused — driving an
old window — and its advertised `mcp.json` would race the new instance's.

Platform environment:

- **macOS** — `embedded` provider; no API key needed. The bundle opts out of **App
  Nap** (`src-tauri/Info.plist` → `NSAppSleepDisabled`): a background app's timers are
  throttled, which starves the MCP accept loop — and the suite drives the app from
  behind the terminal, so K would time out without it.
- **Linux** — `export WEBKIT_DISABLE_DMABUF_RENDERER=1`; with no display server,
  prefix the run with `xvfb-run -a` (e.g. `xvfb-run -a npm run test:e2e`).
- **Windows** — WebView2; the service keeps the Edge driver in sync for you.

## CI

One GitHub Actions job (`e2e`) builds the release binary (`tauri build --no-bundle`)
and runs the suite on the default matrix (macOS / Linux / Windows) on every PR. On
Linux the runner is headless, so the suite runs under `xvfb-run -a` (with
`WEBKIT_DISABLE_DMABUF_RENDERER=1`); without a display the app aborts on startup
before the embedded WebDriver server binds. Capture is covered by the automated
error-path test (B4); the granted happy path (B5) is a manual smoke against a signed
bundle, not part of CI.

## Deliberately out of scope (anti-overtesting)

- No per-tool numeric regression suites — the five spot-checks (E) are the only
  value assertions; everything else is "renders + no error".
- **The batch CLI is not in the wdio suite.** It is a windowless subcommand of the
  app binary, so its engine work is covered by the crate's own unit tests
  (`cli::batch` — see [`cli.md`](cli.md) → Testing); invoking the binary end to end
  needs a display (the same platform event loop as `--mcp`), so that is a manual
  smoke, not a wdio spec.
- No IPC mocks for every command — `browser.tauri.execute()` is used only where a
  UI path can't be driven (the native file dialog, synth fixture setup) or to force
  an error path (I2–I4, I6); never to skip a real, drivable UI path. The audio device
  stubbed in Q is the same kind of boundary: no CI runner has one, and the transport
  is driven from the frontend, so the UI path stays real.
- No visual-snapshot / pixel-diff testing — layout is asserted structurally.
- No performance or load tests.
