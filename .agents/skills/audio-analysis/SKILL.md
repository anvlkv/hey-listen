---
name: audio-analysis
description: How to drive Hey Listen's audio-analysis engine programmatically — via the built-in MCP server (agent access + live UI following) or the batch CLI (`hey-listen analyze`, headless shell/CI). Use when a task needs to open a source, run analyzers, edit graphs, preview, or read results with an MCP client or from a shell.
---

# Driving Hey Listen's analysis engine (MCP + CLI)

Hey Listen exposes its analysis engine through **two programmatic interfaces**
that share one Rust engine path (`audio::analysis::run_window`):

1. **MCP server** — an agent drives the *running* app (opens sources, runs every
   tool, edits graphs, previews, saves) with UI following.
2. **Batch CLI** — `hey-listen analyze <FILE>...` runs the engine over files with
   no window, printing one JSON object per file/tool. Deterministic; for shell/CI.

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

Compute (works headless and bridged): `get_state`, `list_analyzers`,
`open_audio_file`, `close_source`, `render_synth`, `run_analysis`,
`set_analysis_window`, `set_view`, `set_shared_params`, `set_tool_options`,
`set_filter_graph` (headless takes a `GraphSpec` directly), `list_output_devices`,
`list_input_devices`, `list_processes`.

UI-only ("requires the app" headless): `open_tool` / `close_tool`, `get_graph`,
`set_synth_graph`, `preview` / `stop_preview`, `set_output_gain`,
`start_capture` / `stop_capture`, `save_project` / `open_project` / `new_project`,
`list_projects` (server), the note tools (`list_notes`, `get_note`, `create_note`,
`update_note`, `delete_note`, `set_focused_note`), and `set_theme` (installed themes).

Key `run_analysis` semantics:

- `display: false` computes without opening/focusing a tab (default `true`).
- `transient: true` applies `start`/`end`/`params`/`options` for that call only,
  without writing them back to the project (default `false`).
- Results are **compacted** by default: a long numeric array →
  `{ length, min, max, argmin, argmax }`; with gaps →
  `{ length, nulls, min, max, argmin, argmax }`. `includeData: true` returns raw
  arrays; `maxPoints: N` decimates to ≤ N points.

Discover the analyzer catalog with `list_analyzers` (id/title/description/section/keywords)
or `hey-listen analyzers --json`. The full tool inventory is in
[`docs/analysis-tools.md`](docs/analysis-tools.md).

### Protocol + security notes

- JSON-RPC 2.0, newline-delimited, over loopback TCP (token handshake). `initialize`
  echoes the client's `protocolVersion` and advertises `tools` only. `resources`/
  `prompts` answer empty; notifications are ignored.
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
  analyzers   List the analyzer catalog
  analyze     Decode file(s) and run analyzer(s) over them
  synth       Render a synth graph and (optionally) analyze the result
  notes       List the notes in a project file (.heyl)

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
| `-p, --param <K=V>` | Patch a **shared** param (repeatable): `fftSize`, `hop`, `windowFn` (`hann`/`hamming`/`blackman`/`rectangular`), `channel`, `resampleTo`, `freqMinHz`, `freqMaxHz`, `randomizedOverlap`. |
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable): `nMels`, `nMfcc`, `nBands`, `rolloffPercent`, `yinThreshold`, `minF0Hz`/`maxF0Hz`, `barLength`, `windowMs`, `fMinHz`/`fMaxHz`. Name the tool when running several (`-o mfcc.nMfcc=13`); bare `-o K=V` scopes to the sole `--tool`. |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--full` | Include raw result arrays (default: compacted, as in MCP). |
| `--pretty` | Pretty-print a single result instead of JSONL. |
| `--fail-fast` | Stop at the first failure (default: run the whole batch). |
| `--format <json\|csv>` / `--out <FILE\|DIR>` / `--template <FILE>` | Planned (M12/M13). |

`synth <GRAPH.json>` renders the `GraphSpec` to PCM (mono, 48 kHz,
`--seconds`, default 5) then behaves like `analyze` on the rendered source.

`notes <FILE.heyl>` lists a project's notes sorted by time (`--json` = JSONL,
`--full` = full markdown body). Read-only.

### Output, exit codes, examples

**JSONL by default** — one self-describing object per line, streamable with `jq`:

```json
{"file":"a.wav","window":{"start":0.0,"end":2.5},"params":{},"options":{},"result":{"tool":"spectrum","peakHz":440.0}}
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

# Every tool, raw arrays, to a file:
hey-listen analyze mix.wav --all --full > mix.jsonl

# One result, pretty-printed:
hey-listen analyze mix.wav -t spectrum --full --pretty

# 4 s window at 10 s, big FFT, two tools:
hey-listen analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Named per-tool options:
hey-listen analyze a.wav -t melSpectrogram -o melSpectrogram.nMels=40 -t mfcc -o mfcc.nMfcc=13

# Discover ids:
hey-listen analyzers --json | jq -r '.[].id'

# Filter then analyze a folder:
hey-listen analyze ./takes/*.wav -t levels --filter lp.json | jq -c '{file, peak:.result.peakDb}'

# Notes from a saved project:
hey-listen notes mix.heyl --json --full
```

## What is *not* scriptable headless

UI-only work — Workbench tabs, editor-layout graph editing (`get_graph` /
`set_synth_graph`), project save/load, and live preview/capture — needs the app
(bridged MCP). The CLI is file/synth sources only and never opens a window or
bridges to a running app. See `docs/mcp.md` → "Limitations / deferred" and
`docs/cli.md` → "Scope and non-goals" for the full boundaries.
