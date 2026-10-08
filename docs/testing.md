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
| Frontend plugin | `@wdio/tauri-plugin` | `browser.tauri.execute()` for setup (e.g. rendering the synth) and IPC mocking where a UI path is missing. |
| Capability | `browserName: 'wry'`, `tauri:options.application` | Points the service at the release binary. |

The suite runs against the **release** binary (`npm run tauri build`);
`appBinaryPath` → `src-tauri/target/release/hey-listen`.

## Deliverables (this milestone)

1. Add `tauri-plugin-wdio-webdriver = "1"` to `src-tauri/Cargo.toml` and register
   it in `src-tauri/src/lib.rs` (`tauri::Builder::default().plugin(tauri_plugin_wdio_webdriver::init())`).
2. Add dev deps `@wdio/tauri-service` and `@wdio/tauri-plugin`.
3. `wdio.conf.ts` at the repo root with the `embedded` provider + `'wry'` capability.
4. `e2e/` directory — `fixtures/` (generated, deterministic audio), `specs/`,
   `support/` (selectors + helpers).
5. `npm run test:e2e` script.
6. GitHub Actions job that builds the app and runs the suite on the platform matrix.

## Fixtures

Deterministic, generated on the fly (no audio blobs committed) so every run is
reproducible:

| Fixture | Content | Exercises |
| --- | --- | --- |
| `sine440` | 2 s, 48 kHz mono, 440 Hz at −12 dBFS, short fade in/out | waveform, spectrum peak, pitch ≈ 440, level meters, loudness |
| `chirp_noise` | 3 s, 20 Hz→8 kHz log sweep + noise burst at 1.5 s | spectrogram, mel, MFCC, chroma, spectral-shape tools, onsets, tempo, downbeats |
| synth graph | deterministic `sine(440) → output`, rendered via `render_synth` | the synth source path |

`sine440` gives the correctness spot-checks a known, assertable value; `chirp_noise`
gives every spectral/rhythm tool a real, non-flat signal.

## Selectors

Tests select by stable `data-testid` plus the existing ARIA labels (the search box
already carries `aria-label="Search analyzers"`). This milestone adds `data-testid`
hooks only where a test needs one — a thin, test-only attribute, not a refactor.
Convention: `data-testid="toolbar.filter"`, `data-testid="sidebar.search"`,
`data-testid="sidebar.tool.<id>"`, `data-testid="analyzer.tab.<id>"`. The
error/warning indicators get the same treatment — `data-testid="toolbar.error"`,
`data-testid="analyzer.error"`, `data-testid="graph.error"`,
`data-testid="graph.warning"` — so a test asserts the message text, not the CSS.

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
| F4 | Zoom/cursor sync | Hover/zoom one time chart; cursor + x-zoom mirror across the time-group tabs | Scenario |
| F5 | Popovers | Params + about popovers render per-tool config/copy | Smoke |

### G. Timeline

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| G1 | Window range | Drag start/end handles; preview plays, the settled window re-runs analysis | Scenario |
| G2 | Zoom | Zoom a short window; waveform re-renders at higher detail | Smoke |
| G3 | Channel select | Pick L/R/mix on a stereo file; waveform + analyzers agree | Scenario |

### H. Project file (M6) & multi-window (M7)

| # | Test | Asserts | Kind |
| --- | --- | --- | --- |
| H1 | Save/load | `save_project` → `load_project`; source + setup + results round-trip | Scenario |
| H2 | Popout | Pop a tab into its own window; title = tab + source; focus in main raises it | Scenario |

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

## Running

```sh
npm run tauri build          # release binary
npm run test:e2e             # run wdio against the binary
```

Platform environment:

- **macOS** — `embedded` provider; no API key needed.
- **Linux** — `export WEBKIT_DISABLE_DMABUF_RENDERER=1`; headless needs Xvfb/weston.
- **Windows** — WebView2; the service keeps the Edge driver in sync for you.

## CI

One GitHub Actions job builds the release binary and runs the default matrix
(macOS / Linux / Windows) on every PR. Capture is covered by the automated
error-path test (B4); the granted happy path (B5) is a manual smoke against a
signed bundle, not part of CI.

## Deliberately out of scope (anti-overtesting)

- No per-tool numeric regression suites — the five spot-checks (E) are the only
  value assertions; everything else is "renders + no error".
- No IPC mocks for every command — `browser.tauri.execute()` is used only where a
  UI path can't be driven (the native file dialog, synth fixture setup) or to force
  an error path (I2–I4); never to skip a real, drivable UI path.
- No visual-snapshot / pixel-diff testing — layout is asserted structurally.
- No performance or load tests.
