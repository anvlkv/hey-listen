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
`npm run typecheck:e2e` scripts, and the `e2e` CI job. Coverage: 11 spec files,
**70 tests** — A shell (3), B sources (4), C graphs (8), D analyzers (26), E
correctness (5), F cross-cutting (5), G timeline (3), I errors (5), J project +
popout (2), K MCP (4), L MCP UI (5).

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
`closeAllTabs()`, and the **popout spec runs last** (its window is a real Tauri
window the suite can't close — see `j-project.spec.ts`).

**Dockview unmounts hidden panels.** The default renderer keeps only the active
tab mounted, so a test that reads a chart must activate its tab (`activateTab`).

**Synthesized pointer/drag events.** The system WebView doesn't produce W3C pointer
actions (or native HTML5 drag-and-drop) under WebDriver, so `pointerDrag` (timeline
handles, splitter) and `dragPaletteNode` (graph palette) dispatch the app's **real**
`pointer*` handlers directly — the same UI path, just driven by events the harness
can emit. (The palette drag is pointer-based, not HTML5 drag-and-drop, because
Tauri's native file-drop handler consumes HTML5 drags over the WebView.)

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
(regions), `toolbar.filter`, `toolbar.error`, `sidebar.search`,
`sidebar.tool.<id>`, `tab.<id>` (stamped on the dockview tab), `analyzer.<id>`,
`analyzer.error`, `analyzer.params.<id>` / `analyzer.about.<id>`, `graph.error`,
`graph.warning` (the persistent **Output is not connected** banner),
`graph.connection.warning` (the transient rejected-connection banner), `graph.render`,
`graph.clear`, `graph.hint` (the node/link toolbar hint), `graph.node` (a node, also
carrying `data-kind`) / `graphNode(kind)`, `graph.port` (a port label),
`graph.palette.btn` (a palette button), `source.openFile`, `source.kind`,
`source.error`, `timeline.canvas`, `timeline.replace`. All live in
`e2e/support/selectors.ts`.

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
| C2 | Filter bypass | Toggle the Toolbar **Filter** switch; preview/analysis reflect on/off | Scenario |
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
copies. The ids and view kinds come from `src/state/analyzer.ts`:

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

### H. Project file (M6) & multi-window (M7)

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| H0 | Open audio from the OS | Emit the file-association channel (`app:open-project`) with an audio path; it opens as a **fresh project** named after the file, with the audio on the timeline | Scenario |
| H1 | Save/load | `save_project` → `load_project`; source + setup + results round-trip | Scenario |
| H2 | Popout | Right-click a tab → **Pop out to window**; a native window shows just that tool, titled `<tool> — <project>`; selecting it in the Sidebar raises the popout (no duplicate tab); timeline/params/zoom sync; it closes with its parent and reopens on project load | Scenario |

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
| L1 | Popover content | The popover renders the toggle, port, and a `context_servers` snippet | Smoke |
| L2 | Toggle + status | Turning MCP off reads "off"; turning it on shows `listening on 127.0.0.1:` | Scenario |
| L3 | Port input | Committing a port moves the endpoint to `127.0.0.1:<port>` | Scenario |
| L4 | Busy port | A port held by the test process falls back to a free one with an inline note | Scenario |
| L5 | Copy | The Copy button confirms (best-effort on headless CI) and the panel survives | Smoke |

> **Headless CLI (Rust):** `src-tauri/tests/headless_mcp.rs` spawns the real
> `heylisten-mcp --headless` binary and drives `initialize → tools/list →
> open_audio_file → run_analysis → open_tool` over its stdio (run by `cargo test`).
> It is not part of the wdio suite (no webview).

## Running

```sh
npm run tauri build          # release binary
npm run test:e2e             # run wdio against the binary
npm run typecheck:e2e        # type-check the suite (no app needed)
```

Each run writes `e2e/artifacts/wdio-report.json` (plus per-spec JSON and the
service log).

Platform environment:

- **macOS** — `embedded` provider; no API key needed.
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
- No IPC mocks for every command — `browser.tauri.execute()` is used only where a
  UI path can't be driven (the native file dialog, synth fixture setup) or to force
  an error path (I2–I4); never to skip a real, drivable UI path.
- No visual-snapshot / pixel-diff testing — layout is asserted structurally.
- No performance or load tests.
