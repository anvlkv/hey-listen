---
name: audio-analysis
description: How to drive Hey Listen's audio-analysis engine programmatically — via the built-in MCP server (agent access + live UI following) or the batch CLI (`hey-listen analyze`, headless shell/CI). Results arrive as a canonical summary plus a structurally compact result by default (summary / compact / full modes), with `list_analyzers` + `get_analyzer` (and CLI `analyzers [ID]`) for discovery. Use when a task needs to open a source, run analyzers, edit graphs, preview, or read results with an MCP client or from a shell.
---

# Driving Hey Listen's analysis engine (MCP + CLI)

Hey Listen exposes its analysis engine through **two programmatic interfaces**
that share one Rust engine path (`audio::analysis::run_window`):

1. **MCP server** — an agent drives the *running* app (opens sources, runs every
   tool, edits graphs, previews, saves) with UI following.
2. **Batch CLI** — `hey-listen analyze <FILE>...` runs the engine over files with
   no window, printing one JSON object per file/tool. Deterministic; for shell/CI.

Both return the **same envelope** — the effective `window`/`params`/`options`, a
canonical `summary`, and a `result` shaped by the caller's mode — because one Rust
shaper serves the GUI bridge, the headless server, and the CLI (M21; see
[`docs/mcp-cli-ergonomics.md`](docs/mcp-cli-ergonomics.md)).

The authoritative docs are [`docs/mcp.md`](docs/mcp.md) and
[`docs/cli.md`](docs/cli.md). This skill summarizes the usage surface; read those
for design rationale, trade-offs, and the full file map.

## Pick an interface

| Need | Use |
| --- | --- |
| An agent (MCP client) drives the live window, with tabs/UI following along | MCP **bridge** to the running app |
| An agent analyzes files with nothing open | MCP **headless** (auto-fallback) |
| A shell script / CI bulk-analyzes files, no MCP client | **Batch CLI** |
| Read notes from a saved `.heyl` project | **Batch CLI** `notes` |

## MCP server

### Entry points

Two binaries run the same `mcp::run`, which **auto-detects** bridge vs headless:

- The **app binary with `--mcp`** — preferred on macOS/Linux (also works for a
  bundled app). It is a normal program there, so stdio works and it never opens a
  window.
- The **`heylisten-mcp` helper** — a plain console binary (no Tauri app context),
  built next to the app at `src-tauri/target/{debug,release}/heylisten-mcp`.
  Required on **Windows release** (the app binary has no console) and on GUI-less
  hosts.

`--headless` (with `--mcp`) forces headless mode, skipping the probe for a running app.

### Configure a client

The server is **off by default**. Turn it on in the Toolbar **MCP** popover
(choose a port, default `47100`, which falls back to a free port), then use the
popover's **Copy** button to get a ready-to-paste snippet. The canonical shape:

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

The server binds `127.0.0.1` only, advertises its endpoint + a random token in
`mcp.json` under the app data dir, and removes it on stop. The `heylisten-mcp`
bridge connects to whatever app last advertised (one app instance per data dir).

### Bridge vs headless

- **App running + MCP on** → the bridge forwards every `tools/call` to the
  **focused project window's** frontend as `mcp:request`; the window runs the tool
  and replies via `mcp_respond`. UI follows automatically (`open_tool` opens a tab,
  `open_audio_file` replaces the timeline, `get_state` reports what the window shows).
- **No app** → the same command falls back to a **core-native headless** server
  over stdio (no TCP, no window), covering the engine-backed compute subset.

### Tools

`tools/list` always answers (static catalog in `src-tauri/src/mcp/tools/`).
Every tool accepts an optional `target` (a label from `list_projects`) to address a
specific window; `get_state` reports `project.window`.

Compute (works headless and bridged): `get_state`, `list_analyzers`, `get_analyzer`,
`open_audio_file`, `close_source`, `render_synth`, `run_analysis`,
`set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`,
`set_filter_graph` (headless takes a `GraphSpec` directly), `list_output_devices`,
`list_input_devices`, `list_processes`, and the project tools `save_project` /
`open_project` / `new_project` (source + setup + notes; no Workbench layout).

UI-only ("requires the app" headless): `open_tool` / `close_tool`, `get_graph`,
`set_synth_graph`, `preview` / `stop_preview`, `set_output_gain`,
`start_capture` / `stop_capture`, `list_projects` (server), `compare_analysis`,
the note tools (`list_notes`,
`get_note`, `create_note`, `update_note`, `delete_note`, `set_focused_note`), and
`set_theme` (installed themes).

### Results: summary, modes, and discovery

Every `run_analysis` call (and every CLI `analyze` record) carries:

- **`summary`** — `{ tool, label, text, items }`: a stable one-line `text`
  (`"peak 890.62 Hz · level -32.56 dBFS · frames 1707"`) plus labelled, unit-bearing
  `items`. It is computed from the **full** result before shaping, so it is identical in
  every mode. Read it first — it usually answers the question without the arrays.
- **`window` / `params` / `options`** — the **effective** settings the call ran with.
  `options` is the tool's declared defaults overlaid with what the call set, unset fields
  omitted (no null padding).
- **`result`** — shaped by the mode below; absent in summary mode.

| Mode | MCP | CLI | `result` |
| --- | --- | --- | --- |
| summary | `summaryOnly: true` | `--summary` | omitted |
| compact (default) | no flag | no flag | bounded / statistical |
| full | `includeData: true` | `--full` | raw arrays |

- `summaryOnly` + `includeData` (and `--summary` + `--full`) are **mutually exclusive**.
- `maxPoints: N` thins a `full` result to ≤ N points. It is **family-aware** (M21.A):
  series/time axes move together, a matrix is thinned by whole frames (`sourceFrames`,
  spectrogram `hopSize` scaled), and **event/note lists are never thinned**. Check
  `decimatable` from `get_analyzer` before relying on it.
- `axis: "compact"` (M21.A) replaces a uniform `times` array with
  `{ start, hop, length, end }`; the values are unchanged. Use it when a full result is
  actually needed but the repeated time grid is not.
- Compact is **structural per family**, not generic: matrices/spectrograms keep dimensions
  and peak location (each array → `{length,min,max,argmin,argmax}`, plus
  `peakTime`/`peakHz`/`peakDb`); numeric series become stats (with `nulls` for gaps and
  `hop` so an index maps to a time); event/note arrays keep counts plus a **five-record
  preview**, and `noteMetrics` also carries **`bounds`** — every detected span — so
  segmenting never needs a full result.
- `display: false` computes without opening/focusing a tab (default `true`).
- `transient: true` applies `start`/`end`/`params`/`options` for that call only, without
  writing them back (default `false`). Without it they **persist**, so parallel calls can
  inherit each other's window. (Tool calls are serialized per window since M21.A, but the
  persisted state is still shared — use `transient` for independent calls.)

**Discover before you guess.** `list_analyzers` is the compact catalog
(id/title/description/section/keywords); `get_analyzer { id }` is the detail call:
`about` (when-to-use copy), option metadata (`key/label/default/min/max/step/unit/help`),
and the `summaryKeys` the tool's summary produces. The CLI's `analyzers [ID] [--json]`
mirrors both. The full tool inventory is in
[`docs/analysis-tools.md`](docs/analysis-tools.md).

A reliable agent sequence:

```text
get_state                         # source/window/params/project + server mode/version
get_analyzer { id: "pitchYin" }    # options, ranges, family, decimatable, summary keys
run_analysis { tool: "pitchYin", summaryOnly: true }   # one-line answer first
→ read summary.text; request result only if you need the series
```

### Finding events (calls, syllables, notes)

Use the **gated segmenter plus the fine envelope**, not flux peaks:

```text
frameRms     # 10 ms frame / 5 ms hop, linear envelope in dBFS
noteMetrics  # gate + hysteresis + min note/gap; spans, levels, f0, voice quality
```

- `noteMetrics` compact already returns `bounds` for every event; then run the
  per-event analyzers (`spectrum`, `pitchPyin`, `modulation`, …) over each span.
- Set `syllableGapMs` on `noteMetrics` to also get `syllables` (adjacent notes merged
  across a short gap, each with its own RMS/peak over the merged span). Amplitude
  belongs to the syllable, not the note.
- Gate a scalar series with `gateDb` (0 = off) to leave pre-roll/background out of a
  measurement instead of post-filtering `frameRms` (`gateDb`/`gateFloorDb` work on
  `frameRms`, `spectralCentroid`, `spectralRolloff`, `spectralFlatness`,
  `zeroCrossingRate`, and `harmonicRatio`).
- Trust pitch medians only when `voicedFrames` ≥ 8 (`f0Reliable: 1`), and an FM rate only
  when `fmReliable: 1`. `harmonicRatio` is **max autocorrelation, not HNR in dB**; use
  `spectralFlatness` for noisiness.
- `onsets` and `spectralFlux` are **ungated**: they can fire in noise and are a
  cross-check, not a segmenter.
- `loudnessMomentary` is a 400 ms EBU R128 block by default; it smears short calls.
- Set `minF0Hz`/`maxF0Hz` per corpus. The defaults (60–1200 Hz for pitch, 50–2000 for
  `noteMetrics`) are speech/music ranges; a penguin at 75 Hz or a swift at ~3 kHz needs
  an explicit range (e.g. 50–4000).

`list_notes` returns compact note summaries (body excerpt + values text) by default;
pass `full: true` (or use `get_note`) for the full markdown body. That mirrors the CLI's
`notes --full`.

### Protocol + security notes

- JSON-RPC 2.0, newline-delimited, over loopback TCP (token handshake). `initialize`
  echoes the client's `protocolVersion` and advertises `tools` only. `resources`/
  `prompts` answer empty; notifications are ignored.
- Catalog entries carry `title` and `annotations` hints (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`, `openWorldHint`). They are hints, not
  enforcement: replace prompts still apply, and `run_analysis` still writes
  params/options without `transient`.
- A tool failure is a *successful* result with `isError: true` (the agent sees the
  message, not a transport error).
- The agent drives the same commands the UI does — nothing the UI could not do.
  Use `replace: true` on `open_audio_file` / `render_synth` to skip the replace prompt.

## Batch CLI

A subcommand of the app binary (not a third binary), run in `setup` before any
window is created, then prints and exits. Uses `tauri-plugin-cli`/clap, so
`--help` / `--version` come free. Targets a desktop shell (needs a platform event
loop; use `heylisten-mcp --headless` on GUI-less hosts).

```text
hey-listen [OPTIONS] [FILE.heyl]
hey-listen <COMMAND>

Commands:
  analyzers [ID] [--json]   The catalog, or one analyzer's options and summary keys
  analyze                   Decode file(s) and run analyzer(s) over them
  synth                     Render a synth graph and (optionally) analyze the result
  notes                     List the notes in a project file (.heyl)
  compare A.heyl B.heyl     Diff one analyzer across two saved projects

Options:
  -m, --mcp      Run the stdio MCP entry instead of the GUI
      --headless (with --mcp) force the core-native headless MCP server
```

### `analyze <FILE>...`

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable; required unless `--all`. |
| `--all` | Run every analyzer. |
| `--start <SEC>` / `--end <SEC>` | Window (default `0` / full duration). |
| `--windows <FILE>` | Run many windows in one process: one `start,end[,tool,tool…]` per line (`#` comments allowed). A line without tools uses `-t`/`--all`. Not with `--start`/`--end`. |
| `-p, --param <K=V>` | Patch a **shared** param (repeatable): `fftSize`, `hop`, `windowFn` (`hann`/`hamming`/`blackman`/`rectangular`), `channel`, `resampleTo`, `freqMinHz`, `freqMaxHz`, `randomizedOverlap`. |
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable): `nMels`, `nMfcc`, `nBands`, `rolloffPercent`, `yinThreshold`, `minF0Hz`/`maxF0Hz`, `barLength`, `windowMs`, `frameMs`/`hopMs`, `gateDb`/`gateFloorDb`, `hysteresisDb`, `minNoteMs`/`minGapMs`, `syllableGapMs`, `fMinHz`/`fMaxHz`. Name the tool when running several (`-o mfcc.nMfcc=13`); bare `-o K=V` scopes to the sole `--tool`. **Run `analyzers <ID>` for the exact keys, defaults, and ranges.** |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--summary` | Emit `{ file, window, params, options, summary }` only (no `result`). Mutually exclusive with `--full`. |
| `--full` | Include the raw result arrays (default: compacted, exactly as in MCP). |
| `--pretty` | Pretty-print a single result instead of JSONL. |
| `--fail-fast` | Stop at the first failure (default: run the whole batch). |
| `--format <json\|csv>` / `--out <FILE\|DIR>` / `--template <FILE>` | Planned (M12/M13). |

`analyzers [ID] [--json]` is the discovery path: without an ID it prints the catalog
(id, section, title); with one it prints the description/about copy, every option row
(`key`, label, default with unit, `min…max`, step, help), and the summary keys — i.e. the
exact keys `-o` accepts. An unknown ID writes to stderr and exits `1`.

`synth <GRAPH.json>` renders the `GraphSpec` to PCM (mono, 48 kHz,
`--seconds`, default 5) then behaves like `analyze` on the rendered source.

**Scale:** many **files** → the batch CLI (one process, JSONL). Many **windows in one
file** → one headless MCP session or `analyze --windows FILE`, so the 1k-window cost is
not 1k process startups.

`notes <FILE.heyl>` lists a project's notes sorted by time (`--json` = JSONL,
`--full` = full markdown body). Read-only.

### `compare <A.heyl> <B.heyl>`

Diff **the same analyzer** across two saved projects (M25). Each side uses its saved
window, shared params, tool options and `LAYOUT.filterSpec`; the reference project is
never modified.

```bash
hey-listen compare before.heyl after.heyl -t spectrum --summary
hey-listen compare a.heyl b.heyl -t levels -t loudnessIntegrated --overlap
```

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable, one line per tool. Required unless `--all`. |
| `--all` | Every analyzer. |
| `--start` / `--end` | Override both sides' windows. |
| `--a-start` / `--a-end` / `--b-start` / `--b-end` | Override one side's window. |
| `--overlap` | Clip both sides to their absolute-time intersection. |
| `-p` / `-o` / `--filter` | Patch params/options, or override the saved filters, on both sides. |
| `--full` / `--summary` | Delta arrays, or summaries + diff stats only. |

Each line is `{tool, a, b, comparability, diff}`; `diff` is **absent** when the grids
differ (`comparability.mismatches` says why). Only project files — `analyze` covers raw
audio.

### Output, exit codes, examples

**JSONL by default** — one self-describing object per line, streamable with `jq`.
Every record carries the canonical `summary` and no null-padded options. **Logs go to
stderr**, so stdout is pure JSONL (M21.A); you do not need to filter the app's start-up
line.

```json
{"file":"a.wav","window":{"start":0.0,"end":2.5},"params":{"fftSize":2048},"options":{},"summary":{"tool":"spectrum","text":"peak 440 Hz · level -6 dBFS","items":[]},"result":{"tool":"spectrum","peakHz":440.0}}
```

Failures are one line too and don't abort the batch unless `--fail-fast`:

```json
{"file":"a.wav","tool":"tempo","error":"empty analysis window"}
```

| Exit | Meaning |
| --- | --- |
| `0` | Every file/tool succeeded. |
| `1` | At least one file/tool failed (failing line carries `error`), or `notes` couldn't read the project. |
| `2` | Usage error (unknown subcommand/flag, bad `K=V`, missing `-t`) — never falls through to the GUI. |

```bash
# One number per file:
hey-listen analyze *.wav -t loudnessIntegrated | jq -c '{file, lufs: .result.lufs}'

# Sweep with summaries only (smallest useful record):
hey-listen analyze *.wav -t levels --summary | jq -c '{file, summary: .summary.text}'

# Every tool, raw arrays, to a file:
hey-listen analyze mix.wav --all --full > mix.jsonl

# One result, pretty-printed:
hey-listen analyze mix.wav -t spectrum --full --pretty

# 4 s window at 10 s, big FFT, two tools:
hey-listen analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Many windows in one file, one process (one `start,end[,tool…]` per line):
hey-listen analyze call.wav -t noteMetrics --windows windows.txt > call.jsonl

# Gate a series to drop the recording's background:
hey-listen analyze call.wav -t spectralCentroid -o spectralCentroid.gateDb=20 --full

# Named per-tool options:
hey-listen analyze a.wav -t melSpectrogram -o melSpectrogram.nMels=40 -t mfcc -o mfcc.nMfcc=13

# Discover ids, then explain one analyzer's options and summary keys:
hey-listen analyzers --json | jq -r '.[].id'
hey-listen analyzers noteMetrics

# Filter then analyze a folder:
hey-listen analyze ./takes/*.wav -t levels --filter lp.json | jq -c '{file, peak:.result.peakDb}'

# Notes from a saved project:
hey-listen notes mix.heyl --json --full
```

## What is *not* scriptable headless

UI-only work — Workbench tabs, editor-layout graph editing (`get_graph` /
`set_synth_graph`), and live preview/capture — needs the app (bridged MCP).
**Project files are scriptable headless**: `save_project` (with `notes`,
`openTools`, and `embedSource: false` for a file source), `open_project`, and
`new_project` work in `heylisten-mcp --headless`; they write source + setup + notes and
skip the Workbench layout. The CLI is file/synth sources only and never opens a window
or bridges to a running app. See `docs/mcp.md` → "Limitations / deferred" and
`docs/cli.md` → "Scope and non-goals" for the full boundaries.
