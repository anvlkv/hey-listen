# Batch CLI (`heylisten-cli`)

A **plain console binary** that runs the analysis engine over files with no window,
no app, and no MCP client — so a shell script or CI job can do bulk analysis and read
the results as JSON. It is the non-MCP sibling of the headless MCP server: the same
engine, a friendlier calling convention.

This is planned (**M10**), not yet built. See [`roadmap.md`](roadmap.md) → M10 and
[`decisions.md`](decisions.md) → ADR-14.

## Why a separate binary (not the app binary / `tauri-plugin-cli`)

The app binary's `--mcp` / `--headless` flags are declared with `tauri-plugin-cli`,
and a `.heyl` path is handled in `setup`. That route is wrong for a batch tool:

- `app.cli().matches()` needs a Tauri **app context**, so only the app binary can use
  it — and the app binary is heavy (it starts the Tauri runtime) and, in the Windows
  release, has **no console** (a documented Tauri limitation), so it cannot write to
  the calling shell.
- A batch tool must print to stdout and run with no GUI, on a headless host, and in
  CI. That is exactly the reasoning that already made `heylisten-mcp` a plain console
  binary (`src/bin/heylisten-mcp.rs`), not a Tauri app.

So `heylisten-cli` mirrors `heylisten-mcp`: a binary that links the lib but never
builds a Tauri app or opens a window. It parses its own arguments with **`clap`**
(already in the dependency tree via `tauri-plugin-cli`, so it adds no new build).
The app binary keeps using `tauri-plugin-cli` for `--mcp` / `--headless`, unchanged.

> **Not to be confused with** `heylisten-mcp`: that is an MCP **stdio server** (a
> client speaks JSON-RPC to it). `heylisten-cli` is a **command** you run in a shell
> and read JSON from. They share the engine session (below) but are different
> interfaces. The CLI is also *deliberately not* a bridge — unlike `heylisten-mcp`, it
> never attaches to a running app: a batch job must be deterministic and must not
> drive the user's live window.

## Shape

```text
  shell / CI                    heylisten-cli                 engine session
  ┌──────────┐  argv + files   ┌──────────────┐   same calls  ┌───────────────┐
  │  bash    │ ──────────────► │  clap parse  │ ────────────► │  engine::     │
  │  jq      │ ◄────────────── │  → dispatch  │ ◄──────────── │  Session      │
  └──────────┘   JSONL stdout  └──────────────┘               └───────┬───────┘
                                                                      │
                                                  audio::decode / analysis::run_window
                                                  audio::graph / audio::analyzers
```

The CLI is a thin front end: it maps flags onto the **same** operations the headless
MCP server runs (`open_audio_file`, `run_analysis`, `set_shared_params`,
`set_tool_options`, `render_synth`, `list_analyzers`), through one shared
`engine::Session`. So there is no third DSP path — the GUI command, the headless MCP
server, and the CLI all reach `analysis::run_window` and the other engine functions.

## Commands

```text
heylisten-cli <COMMAND>

Commands:
  analyzers   List the analyzer catalog
  analyze     Decode file(s) and run analyzer(s) over them
  synth       Render a synth graph and (optionally) analyze the result

Options:
  -h, --help     Print help
  -V, --version  Print version
```

### `analyze <FILE>...`

Decode each file and run one or more analyzers over a window.

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id to run. Repeatable. Required unless `--all`. |
| `--all` | Run every analyzer in the catalog. |
| `--start <SEC>` | Window start in seconds (default `0`). |
| `--end <SEC>` | Window end in seconds (default: full duration). |
| `-p, --param <K=V>` | Patch a **shared** param (repeatable), using the same keys MCP's `set_shared_params` takes: `fftSize`, `hop`, `windowFn` (`hann`/`hamming`/`blackman`/`rectangular`), `channel`, `resampleTo`, `freqMinHz`, `freqMaxHz`, `randomizedOverlap`. |
| `-o, --option <K=V>` | Patch a **per-tool** option for the preceding `--tool` (repeatable), using the same keys MCP's `set_tool_options` takes (`nMels`, `nMfcc`, `nBands`, `rolloffPercent`, `yinThreshold`, `minF0Hz`/`maxF0Hz`, `barLength`, `windowMs`, `fMinHz`/`fMaxHz`). |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--full` | Include the raw result arrays (default: compacted — see below). |
| `--pretty` | Pretty-print a single result instead of one JSON line per result. |
| `--fail-fast` | Stop at the first failing file/tool (default: run the whole batch and report). |

### `analyzers`

| Option | Meaning |
| --- | --- |
| `--json` | Emit the analyzer catalog as JSON (the same array MCP's `list_analyzers` returns). Otherwise a plain `id  section  title` table. |

### `synth <GRAPH.json>`

Render a synth graph to PCM (mono, `48 kHz`, `--seconds` default `5`), then behave
exactly like `analyze` on the rendered source. With no `-t`, it prints the rendered
source's summary (channels, sample rate, frames, duration).

| Option | Meaning |
| --- | --- |
| `--seconds <SEC>` | Rendered length (default `5`). |
| *(analyze options)* | `-t` / `-p` / `-o` / `--filter` / `--full` / `--pretty` / `--fail-fast` as above. |

The graph is the same `{ "nodes": [...], "edges": [...] }` `GraphSpec` the headless
MCP `render_synth` takes — there is no graph *editor* here, so the graph is always
given as a file.

## Output

**JSONL by default** — one self-describing object per line, so `jq -c` streams it:

```json
{"file":"a.wav","tool":"spectrum","window":{"start":0.0,"end":2.5},"result":{"peakHz":440.0,"...":0}}
```

The object is exactly what MCP's `run_analysis` returns (`tool`, `window`, `result`)
with the `file` added. Results are **compacted** by default (long numeric arrays →
`{length,min,max}`; other long arrays → their length) so a spectrogram does not flood
the terminal — this is the same compaction MCP applies; `--full` returns the raw
arrays.

A failure is one line too, and does not abort the batch unless `--fail-fast`:

```json
{"file":"a.wav","tool":"tempo","error":"empty analysis window"}
```

`--pretty` prints a single (human-readable) JSON object — for one file / one tool.

**Exit codes:**

| Code | Meaning |
| --- | --- |
| `0` | Every file/tool succeeded. |
| `1` | At least one file/tool failed (the failing lines carry `error`). |
| `2` | Usage error (unknown flag, bad `K=V`, missing `-t`). |

## Examples

```bash
# One number per file, streamed as JSONL:
heylisten-cli analyze *.wav -t loudnessIntegrated | jq -c '{file, lufs: .result.lufs}'

# Every tool, raw arrays, pretty, to a file:
heylisten-cli analyze mix.wav --all --full --pretty > mix.json

# A 4 s window at 10 s with a big FFT, two tools, one file:
heylisten-cli analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Discover ids:
heylisten-cli analyzers --json | jq -r '.[].id'

# Filter, then analyze, over a whole folder:
heylisten-cli analyze ./takes/*.wav -t levels --filter lp.json | jq -c '{file, peak:.result.peakDb}'
```

## Scope and non-goals

In scope (the **engine-backed compute subset**, matching headless MCP):

- `analyzers`, `analyze`, `synth` — decode a file, run analyzers, render a synth
  graph, list the catalog, with shared params / per-tool options / a filter graph.

Deliberately out of scope:

- **UI-only tools** — Workbench tabs, editor-layout graph editing, project
  save/load, and live preview/capture. These need the app (see
  [`mcp.md`](mcp.md) → Limitations).
- **Device/process enumeration** (`devices`) — deferred. On macOS enumerating
  outputs goes through the same `supports_output` → AudioUnit path that makes the
  GUI picker prompt for microphone/audio-capture permission; a batch CLI must never
  prompt. It becomes available once the AudioUnit-free enumeration lands (the same
  fix the picker needs). It is not needed for bulk analysis anyway.
- **Bridging to a running app** — always standalone (see above).
- **Live capture input** — file and synth sources only.

> `--filter` is the one place the CLI is *ahead* of the headless MCP subset: the
> engine already applies `state.audio.filter` in `run_window`, so a
> `Session::set_filter(GraphSpec)` setter lets the CLI condition the signal before
> analysis — the same "take the graph directly" idea as headless `render_synth`.
> Wiring that setter back into the headless MCP `set_filter_graph` is a trivial
> follow-on, deferred.

## Files

| Path | Role |
| --- | --- |
| `src-tauri/src/bin/heylisten-cli.rs` | the process entry (`main` → `hey_listen_lib::run_cli()`). |
| `src-tauri/src/cli/mod.rs` | the `cli` module root (re-exports `app` + `batch`). |
| `src-tauri/src/cli/app.rs` | the app binary's `tauri-plugin-cli` flags (`--mcp` / `--headless`) — moved, unchanged. |
| `src-tauri/src/cli/batch.rs` | the `clap` definition + `run`: flags → engine `Session`. |
| `src-tauri/src/engine.rs` | the headless engine session (moved from `mcp/dispatch.rs`; shared by the CLI and headless MCP). |
| `src-tauri/src/mcp/headless.rs` | the stdio loop now drives `engine::Session`. |
| `src-tauri/tests/batch_cli.rs` | the integration test (spawns the binary over a generated WAV). |

## Testing

`src-tauri/tests/batch_cli.rs` spawns the real `heylisten-cli` binary (via
`CARGO_BIN_EXE_heylisten-cli`), writes a sine WAV to a temp dir, and asserts:

- `analyzers --json` lists `spectrum` (and matches the catalog length);
- `analyze <wav> -t spectrum --full` prints one JSONL line whose `result.peakHz` is
  near 440 Hz;
- a batch of two files prints two lines and exits `0`;
- an unknown tool exits `1` with an `error` line.

Run with `cargo test` in `src-tauri/` (no webview, so it is not part of the wdio
suite — see [`testing.md`](testing.md)).
