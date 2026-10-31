---
name: audio-analysis
description: Drive Hey Listen's audio-analysis engine programmatically — via the built-in MCP server (agent access + live UI following) or the batch CLI (`hey-listen analyze`, headless shell/CI). Covers picking the interface, the discover → run → read workflow, the tool inventory, result modes (summary / compact / full), event segmentation, comparison, and data/chart export. Use when a task needs to open a source, run analyzers, segment calls/syllables/notes, compare projects, or read results from an MCP client or a shell.
---

# Driving Hey Listen's analysis engine (MCP + CLI)

Hey Listen exposes one analysis engine (`audio::analysis::run_window`) through two
programmatic interfaces:

1. **MCP server** — an agent drives the *running* app (open sources, run tools, edit
   graphs, preview, save) with the UI following along.
2. **Batch CLI** — `hey-listen analyze <FILE>...` runs the engine over files with no
   window, printing one JSON object per file/tool. Deterministic; for shell/CI.

Both return the **same envelope** — effective `window` / `params` / `options`, a canonical
`summary`, and a `result` shaped by the requested mode. Authoritative docs:
[`docs/mcp.md`](docs/mcp.md), [`docs/cli.md`](docs/cli.md),
[`docs/analysis-tools.md`](docs/analysis-tools.md). This skill is the consumer-facing
summary; read those for rationale and the full file map.

## Pick an interface

| Need | Use |
| --- | --- |
| An agent drives the live window, tabs/UI following | MCP **bridge** to the running app |
| An agent analyzes files with nothing open | MCP **headless** (auto-fallback) |
| Shell script / CI bulk-analyzes files | **Batch CLI** |
| Read notes from a saved `.heyl` project | **Batch CLI** `notes` |

## The reliable workflow

Discover before you guess, and read the summary before the arrays:

```text
list_analyzers                         # compact catalog: id / title / section / family / keywords
get_analyzer { id }                    # about copy, option ranges, family, decimatable, summary keys
get_state                              # source shape, window, shared params, project, server mode
run_analysis { tool, summaryOnly: true }   # one-line answer first
→ read summary.text; request result only if you need the series
```

- Set the shared window/params once with `set_analysis_window` / `set_shared_params`,
  then per-tool options with `set_tool_options`. Pass overrides inline to `run_analysis`
  instead when you want them for a single call.
- Use `transient: true` on `run_analysis` for independent calls — without it, window and
  option overrides are **written back** and later calls inherit them.
- Pass `display: false` to compute without opening/focusing a tab (default `true`).

## MCP server

### Entry points + configure

Two binaries run the same `mcp::run`, auto-detecting bridge vs headless:

- **App binary with `--mcp`** — preferred on macOS/Linux (works for a bundled app). Never
  opens a window.
- **`heylisten-mcp` helper** — a console binary next to the app
  (`src-tauri/target/{debug,release}/heylisten-mcp`); required on Windows release and on
  GUI-less hosts. `--headless` (with `--mcp`) forces headless, skipping the app probe.

Turn the server on in the Toolbar **MCP** popover (default port `47100`), then use its
**Copy** button:

```json
{
  "mcpServers": {
    "hey-listen": {
      "command": "/absolute/path/to/Hey Listen.app/Contents/MacOS/hey-listen",
      "args": ["--mcp"]
    }
  }
}
```

### Bridge vs headless

- **App running + MCP on** → each `tools/call` is forwarded to the **focused project
  window's** frontend and runs through the same stores/commands the UI uses; UI follows
  (`open_tool` opens a tab, `open_audio_file` replaces the timeline, `get_state` reports
  what the window shows).
- **No app** → the same command falls back to a **core-native headless** server over
  stdio (no TCP, no window), covering the engine-backed compute subset.

Every tool accepts an optional `target` (a label from `list_projects`) to address a
specific window instead of the focused one.

### Tools

`tools/list` always answers (static catalog). Compute tools work **headless and bridged**;
the rest answer *"requires the app"* headless.

| Group | Tools | Headless? |
| --- | --- | --- |
| Observe | `get_state`, `list_analyzers`, `get_analyzer` | yes |
| Source | `open_audio_file`, `close_source`, `render_synth`, `list_input_devices`, `list_output_devices`, `list_processes` | yes |
| Analyze | `run_analysis`, `set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`, `set_filter_graph` | yes |
| Project | `save_project`, `open_project`, `new_project` | yes (source + setup + notes; no Workbench layout) |
| Export (data) | `export_analysis`, `export_all` | yes (`export_all` headless takes an explicit `tools` list) |
| Tabs | `open_tool`, `close_tool` | app-only |
| Graphs | `get_graph`, `set_synth_graph` | app-only |
| Preview/capture | `preview`, `stop_preview`, `set_output_gain`, `start_capture`, `stop_capture` | app-only |
| Multi-window / compare | `list_projects`, `compare_analysis` | app-only (needs open windows) |
| Notes | `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`, `set_focused_note` | app-only |
| Export (chart) | `export_chart` | app-only (needs the rendered canvas) |
| Themes | `list_themes`, `get_theme`, `set_theme`, `import_theme`, `export_theme` | headless lists bundled only |

Templates (M13) are planned and **not yet** exposed as tools.

## Results: summary, compact, full

Every `run_analysis` call (and every CLI `analyze` record) carries:

- **`summary`** — `{ tool, label, text, items }`: a stable one-line `text` plus labelled,
  unit-bearing `items`, computed from the **full** result so it is identical in every mode.
  Read it first — it usually answers the question.
- **`window` / `params` / `options`** — the **effective** settings the call ran with
  (unset option fields omitted, no null padding).
- **`result`** — shaped by mode:

| Mode | MCP | CLI | `result` |
| --- | --- | --- | --- |
| summary | `summaryOnly: true` | `--summary` | omitted |
| compact (default) | no flag | no flag | structural stats |
| full | `includeData: true` | `--full` | raw arrays |

- `summaryOnly` + `includeData` (and `--summary` + `--full`) are **mutually exclusive**.
- Compact is **structural per family**: matrices/spectrograms keep dimensions + peak
  location (`peakTime`/`peakHz`/`peakDb`); numeric series become stats (with `nulls` for
  gaps and `hop` so an index maps to a time); event/note arrays keep counts plus a
  five-record preview. `noteMetrics` also carries **`bounds`** — every detected span — so
  segmenting never needs a full result.
- `maxPoints: N` thins a full result to ≤ N points, **family-aware** (time axes move
  together, matrices thin by whole frames). It never removes events from
  `noteMetrics`/`onsets` lists. Check `decimatable` from `get_analyzer` before relying on it.
- `axis: "compact"` replaces a `times` array with `{ start, hop, length, end }` (an
  overlap-add edge frame as `firstHop`/`lastHop`). Use when a full result is needed but
  the repeated time grid is not.

**Discovery.** `list_analyzers` is the catalog; `get_analyzer { id }` gives `about` copy,
option metadata (`key/label/default/min/max/step/unit/help`), `family`, `decimatable`, and
`summaryKeys`. The CLI's `analyzers [ID] [--json]` mirrors both. Unknown option keys are
**errors** (canonical camelCase; snake_case aliases accepted).

## Finding events (calls, syllables, notes)

Use the **gated segmenter + fine envelope**, not flux peaks:

```text
frameRms     # ~10 ms frame / 5 ms hop, linear envelope in dBFS
noteMetrics  # gate + hysteresis + min note/gap; spans, levels, f0, voice quality
```

- `noteMetrics` compact returns `bounds` for every event; then run per-event analyzers
  (`spectrum`, `pitchPyin`, `modulation`, …) over each span.
- `syllableGapMs` on `noteMetrics` also yields `syllables` (adjacent notes merged across a
  short gap). Amplitude belongs to the syllable, not the note.
- Gate a scalar series with `gateDb` (0 = off) to exclude pre-roll/background instead of
  post-filtering `frameRms`. Works on `frameRms`, `spectralCentroid`, `spectralRolloff`,
  `spectralFlatness`, `zeroCrossingRate`, `harmonicRatio`.
- Trust pitch medians only when `voicedFrames ≥ 8` (`f0Reliable: 1`), an FM rate only when
  `fmReliable: 1`. `harmonicRatio` is **max autocorrelation, not HNR in dB**; use
  `spectralFlatness` for noisiness.
- `onsets` and `spectralFlux` are **ungated** — a cross-check, not a segmenter.
- `loudnessMomentary` is a 400 ms EBU R128 block; it smears short calls.
- Set `minF0Hz`/`maxF0Hz` per corpus. The defaults (60–1200 Hz pitch, 50–2000 `noteMetrics`)
  are speech/music ranges — a 75 Hz penguin or ~3 kHz swift needs an explicit range.

`list_notes` returns compact summaries by default; pass `full: true` (or `get_note`) for
the full markdown body and frozen values snapshot.

## Batch CLI

A subcommand of the app binary, run in `setup` before any window exists, then print and
exit. `--help` / `--version` come free.

```text
hey-listen [OPTIONS] [FILE.heyl]
hey-listen <COMMAND>

Commands:
  analyzers [ID] [--json]   catalog, or one analyzer's options + summary keys
  analyze                   decode file(s) and run analyzer(s) over them
  synth                     render a synth graph, then (optionally) analyze it
  notes                     list notes in a project file (.heyl)
  compare A.heyl B.heyl     diff one analyzer across two saved projects

Options:
  -m, --mcp      run the stdio MCP entry instead of the GUI
      --headless (with --mcp) force the core-native headless MCP server
```

### `analyze <FILE>...`

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable; required unless `--all`. |
| `--all` | Run every analyzer. |
| `--start <SEC>` / `--end <SEC>` | Window (default `0` / full duration). |
| `--windows <FILE>` | Many windows in one process: one `start,end[,tool…]` per line (`#` comments). A line without tools uses `-t`/`--all`. Not with `--start`/`--end`. |
| `-p, --param <K=V>` | Patch a **shared** param (repeatable): `fftSize`, `hop` (fraction of `fftSize`; `0.25` = 75% overlap), `windowFn`, `channel`, `resampleTo`, `freqMinHz`, `freqMaxHz`, `randomizedOverlap`. |
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable). Name the tool with several (`-o mfcc.nMfcc=13`); bare `-o K=V` scopes to the sole `--tool`. **Run `analyzers <ID>` for exact keys/defaults/ranges.** |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--summary` / `--full` | Summary only / raw arrays (default: compacted). Mutually exclusive. |
| `--pretty` | Pretty-print a single result instead of JSONL. |
| `--fail-fast` | Stop at the first failure (default: run the whole batch). |
| `--format <json\|csv>` / `--csv` / `--out <FILE\|DIR>` | Data export: JSON provenance envelope or wide-matrix CSV (+ `.meta.json` sidecar); write to file/dir instead of stdout. |

**Scale:** many **files** → batch CLI (one process, JSONL). Many **windows in one file** →
`analyze --windows FILE` or one headless MCP session (1k windows ≠ 1k process startups).

### `compare <A.heyl> <B.heyl>`

Diff **the same analyzer** across two saved projects, each using its own saved window,
shared params, tool options and filter. Matching is **relative** (each side starts at 0);
`--overlap` opts into the old absolute-intersection rule.

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable, one line per tool. Required unless `--all`. |
| `--all` | Every analyzer. |
| `--start` / `--end` | Override both sides' windows. |
| `--a-start` / `--a-end` / `--b-start` / `--b-end` | Override one side's window. |
| `--b-offset <SECS>` | Move side B on the relative axis (positive = later; default `0`). |
| `--overlap` | Clip both sides to their absolute-time intersection. |
| `-p` / `-o` / `--filter` | Patch params/options, or override saved filters, on both sides. |
| `--full` / `--summary` | Delta arrays, or summaries + diff stats only. |

Each line is `{ tool, a, b, comparability, diff }`; `diff` is absent when the grids differ
(`comparability.mismatches` says why). Project files only — `analyze` covers raw audio.

### Output, exit codes, examples

**JSONL by default** — one self-describing object per line, streamable with `jq`. Logs go
to **stderr**, so stdout is pure JSONL.

| Exit | Meaning |
| --- | --- |
| `0` | Every file/tool succeeded. |
| `1` | At least one file/tool failed (failing line carries `error`). |
| `2` | Usage error (unknown subcommand/flag, bad `K=V`, missing `-t`). |

```bash
# One number per file:
hey-listen analyze *.wav -t loudnessIntegrated | jq -c '{file, lufs: .result.lufs}'

# Sweep with summaries only:
hey-listen analyze *.wav -t levels --summary | jq -c '{file, summary: .summary.text}'

# 4 s window at 10 s, big FFT, two tools:
hey-listen analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Many windows in one file, one process:
hey-listen analyze call.wav -t noteMetrics --windows windows.txt > call.jsonl

# Gate a series to drop the recording's background:
hey-listen analyze call.wav -t spectralCentroid -o spectralCentroid.gateDb=20 --full

# Discover ids, then explain one analyzer:
hey-listen analyzers --json | jq -r '.[].id'
hey-listen analyzers noteMetrics

# Diff two saved projects:
hey-listen compare before.heyl after.heyl -t spectrum --summary
```

## What is *not* scriptable headless

UI-only work — Workbench tabs, editor-layout graph editing (`get_graph` /
`set_synth_graph`), live preview/capture, `compare_analysis`, notes, and chart-image
export — needs the app (bridged MCP). **Project files are scriptable headless**:
`save_project` (with `notes`, `openTools`, `embedSource: false` for a file source),
`open_project`, and `new_project` work in `heylisten-mcp --headless`; they write source +
setup + notes and skip the Workbench layout. The CLI is file/synth sources only and never
opens a window or bridges to a running app.
