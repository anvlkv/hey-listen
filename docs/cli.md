# Batch CLI (`hey-listen analyze`)

A **subcommand of the app binary** that runs the analysis engine over files without
opening or driving a window — so a shell script or CI job can do bulk analysis and
read the results as JSON. It is the non-MCP sibling of the headless MCP server: the
same engine, a friendlier calling convention.

This is delivered (**M10**). The batch logic lives in `src-tauri/src/cli/batch.rs`;
the interface is declared in `tauri.conf.json` → `plugins.cli`. See
[`roadmap.md`](roadmap.md) → M10 and [`decisions.md`](decisions.md) → ADR-14.

## Why the app binary (and `tauri-plugin-cli`)

The CLI **must be declared with `tauri-plugin-cli`** (`plugins.cli` in
`tauri.conf.json`) — the project's single source of truth for the interface, and the
same mechanism the app already uses for `--mcp` / `--headless`. That decides where it
lives: `tauri-plugin-cli` reads its definition from the app context
(`app.cli().matches()` → `Cli`, which cannot be constructed outside the plugin), so
only a process that builds a Tauri app can use it.

- The app binary is that process. It runs the batch command **in `setup`, before any
  window is created**, then prints and exits — precisely how `--mcp` already runs
  windowless. The main window is declared `"create": false`, and nothing creates it on
  this path, so the CLI **never opens, shows, or drives a window** (no webview, no IPC,
  no UI following).
- Therefore there is **no third binary and no hand-rolled parser**: the interface lives
  in `plugins.cli` and is parsed by the plugin (which uses `clap` under the hood, so
  `--help` / `--version` and per-subcommand help come for free).
- `heylisten-mcp` stays a **separate plain console binary**, unchanged: it is an MCP
  stdio server, not a Tauri app, so it reads its one flag directly (it cannot use the
  plugin — see its module docs).

Known trade-offs (kept visible, not hidden):

- **Windows release:** the app binary has no console, so `hey-listen analyze` cannot
  write to the calling shell there (Tauri [#8305](https://github.com/tauri-apps/tauri/issues/8305)).
- **No-display host:** a Tauri app needs a platform event loop, so the app binary does
  not start on a bare GUI-less host. That is what **`heylisten-mcp --headless`** covers;
  the batch CLI targets a shell on a desktop (macOS/Linux), where stdout works.

> **Not to be confused with** `heylisten-mcp`: that is an MCP **stdio server** (a
> client speaks JSON-RPC to it). This CLI is a **command** you run in a shell and read
> JSON from. They share the engine session (below) but are different interfaces. The
> CLI is *deliberately not* a bridge — unlike `heylisten-mcp`, it never attaches to a
> running app: a batch job must be deterministic and must not drive the user's window.

## Shape

```text
  shell / CI                       hey-listen (app binary)            engine session
  ┌──────────┐  argv + files   ┌───────────────────────────┐  same calls ┌──────────────┐
  │  bash    │ ──────────────► │ plugins.cli → matches()   │ ──────────► │  headless    │
  │  jq      │ ◄────────────── │  setup: subcommand? → run │ ◄────────── │  session     │
  └──────────┘   JSONL stdout  └───────────────────────────┘             └──────┬───────┘
                                  (no window is ever created)                  │
                                                      audio::decode / analysis::run_window
                                                      audio::graph / audio::analyzers
```

`setup` resolves the entry once (see [`architecture.md`](architecture.md)): `--mcp` →
the MCP stdio entry; a **subcommand** → the batch command; neither → build the GUI.

The batch command is a thin front end: it maps the matched args onto the **same**
operations the headless MCP server runs (`open_audio_file`, `run_analysis`,
`set_shared_params`, `set_tool_options`, `render_synth`, `list_analyzers`), through the
one shared headless session. So there is no third DSP path — the GUI command, the
headless MCP server, and the CLI all reach `analysis::run_window` and the other engine
functions.

## Commands

```text
hey-listen [OPTIONS] [FILE.heyl]
hey-listen <COMMAND>

Commands:
  analyzers   List the analyzer catalog
  analyze     Decode file(s) and run analyzer(s) over them
  synth       Render a synth graph and (optionally) analyze the result

Options:
  -m, --mcp      Run the stdio MCP entry instead of the GUI
      --headless (with --mcp) force the core-native headless MCP server
  -h, --help
  -V, --version
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
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable), using the same keys MCP's `set_tool_options` takes (`nMels`, `nMfcc`, `nBands`, `rolloffPercent`, `yinThreshold`, `minF0Hz`/`maxF0Hz`, `barLength`, `windowMs`, `fMinHz`/`fMaxHz`). **Name the tool** when several are run (`-o mfcc.nMfcc=13`); a bare `-o K=V` is scoped to the sole `--tool`. The tool must be named with several tools because the plugin's parsed matches do not preserve the order of flags on the command line. |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--full` | Include the raw result arrays (default: compacted — see below). |
| `--pretty` | Pretty-print a single result instead of one JSON line per result. |
| `--fail-fast` | Stop at the first failing file/tool (default: run the whole batch and report). |

Analyzer ids are **not** enumerated in `plugins.cli` (that would duplicate the catalog
in JSON); they are validated by the engine against `audio/analyzers.rs` when they run, so
an unknown id produces one `error` line and exit `1` (`{"file":…,"tool":…,"error":"unknown analyzer: …"}`).
A malformed `K=V`, an unknown param/option key, a missing file or `-t`, a bad
`--seconds`/`--start`/`--end` value, or a `--pretty` stream that is not a single result is
a **usage error** (printed to stderr, exit `2`) — it never falls through to the GUI.

### `analyzers`

| Option | Meaning |
| --- | --- |
| `--json` | Emit the analyzer catalog as JSON (the same array MCP's `list_analyzers` returns). Otherwise a plain `id  section  title` table. |

### `synth <GRAPH.json>`

Render a synth graph to PCM (mono, `48 kHz`, `--seconds` default `5`), then behave
exactly like `analyze` on the rendered source. With no `-t` (and no `--all`), it prints
the rendered source's summary as one line — `{"file": <GRAPH.json>, "source": { "sampleRate", "channels", "frames", "duration", … }}`.

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

A whole file that cannot be opened fails without a `tool` (there is no tool yet):

```json
{"file":"a.wav","error":"…"}
```

`synth` uses the graph file path as its `file` label, so its lines are shaped the same
way. `--pretty` prints a single (human-readable) JSON object — for one file / one tool.

**Exit codes:**

| Code | Meaning |
| --- | --- |
| `0` | Every file/tool succeeded. |
| `1` | At least one file/tool failed (the failing lines carry `error`). |
| `2` | Usage error (unknown subcommand/flag, bad `K=V`, missing `-t`). |

> **Usage errors must not silently open the GUI.** `plugins.cli` parsing reports a
> `DisplayHelp` / `DisplayVersion` as a `help` / `version` arg (printed, exit `0`), but a
> genuine parse error comes back as `Err`. `cli::parse` treats a parse error as "no
> flags" so a `.heyl` path still opens (the file-association path) — *unless* the first
> positional token names a batch subcommand (`subcommand_in_argv`), in which case the
> error is printed to stderr and the process exits `2` instead of launching the app.
> A `Mapping` error (bad `K=V`, missing `-t`, an unknown `-o` key) is likewise an
> `Entry::Usage`: printed and exited `2`.

## Examples

```bash
# One number per file, streamed as JSONL:
hey-listen analyze *.wav -t loudnessIntegrated | jq -c '{file, lufs: .result.lufs}'

# Every tool of one file, raw arrays, as JSONL to a file:
hey-listen analyze mix.wav --all --full > mix.jsonl

# One result, pretty-printed:
hey-listen analyze mix.wav -t spectrum --full --pretty > spectrum.json

# A 4 s window at 10 s with a big FFT, two tools, one file:
hey-listen analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Per-tool options are named: a 40-band mel spectrogram then MFCCs:
hey-listen analyze a.wav -t melSpectrogram -o melSpectrogram.nMels=40 -t mfcc -o mfcc.nMfcc=13

# Discover ids:
hey-listen analyzers --json | jq -r '.[].id'

# Filter, then analyze, over a whole folder:
hey-listen analyze ./takes/*.wav -t levels --filter lp.json | jq -c '{file, peak:.result.peakDb}'
```

## Scope and non-goals

In scope (the **engine-backed compute subset**, matching headless MCP):

- `analyzers`, `analyze`, `synth` — decode a file, run analyzers, render a synth
  graph, list the catalog, with shared params / per-tool options / a filter graph.

Deliberately out of scope:

- **UI-only tools** — Workbench tabs, editor-layout graph editing, project
  save/load, and live preview/capture. These need the app's windows
  (see [`mcp.md`](mcp.md) → Limitations).
- **Device/process enumeration** (`devices`) — deferred. On macOS enumerating
  outputs goes through the same `supports_output` → AudioUnit path that makes the
  GUI picker prompt for microphone/audio-capture permission; a batch CLI must never
  prompt. It becomes available once the AudioUnit-free enumeration lands (the same
  fix the picker needs). It is not needed for bulk analysis anyway.
- **Bridging to a running app** — always standalone (see above).
- **Live capture input** — file and synth sources only.
- **Opening a window of any kind** — the command runs and exits before windows exist.

> `--filter` conditions the signal before analysis through the shared headless
> `set_filter_graph` tool — the same one `heylisten-mcp --headless` now exposes. The
> engine applies `state.audio.filter` in `run_window`, so both take the `GraphSpec`
> directly (there is no graph editor headless), exactly like headless `render_synth`.
> The CLI validates the graph (it must compile as a filter) when it maps the request,
> so a bad `--filter` is a usage error (exit `2`).

## Files

| Path | Role |
| --- | --- |
| `src-tauri/tauri.conf.json` | the `plugins.cli` interface: the `analyzers` / `analyze` / `synth` subcommands + their args. |
| `src-tauri/src/cli/mod.rs` | the plugin flags + the `setup` entry: `--mcp` → MCP, a subcommand → batch, else GUI. |
| `src-tauri/src/cli/batch.rs` | the batch logic: `Matches` → a request → the headless session; JSONL output; unit tests. |
| `src-tauri/src/mcp/dispatch.rs` | the headless session, reused (the shared engine facade; `set_filter_graph` lives here). |
| `src-tauri/src/audio/{decode,analysis,analyzers,graph}.rs` | the engine functions the batch command calls. |

## Testing

- **Batch logic (display-free).** The command's work is a plain function
  (`cli::batch::run`) over a crate-local `Request` (command, files, tools, params,
  options, window, `--full`/`--pretty`/`--fail-fast`), so `cargo test` exercises it with
  no Tauri app and no display: it runs over a generated sine WAV and asserts `spectrum`'s
  peak is near 440 Hz, two files print two lines, an unknown tool yields an `error` line
  + exit `1`, a missing file fails without a `tool`, `synth` renders and reports a
  summary, and `analyzers` prints the catalog as JSON or a table.
- **Arg mapping.** `cli::batch::build_request` is unit-tested by feeding synthetic
  `Matches` values (`Matches::default()` with `args` set — the plugin's `ArgData` is
  `#[non_exhaustive]`, so fields are set on a `Default` instance), so the `plugins.cli`
  vocabulary (files, `-t`/`--all`, `-p`, `-o`, window, flags, the usage errors) is
  covered without building the app.
- **Binary invocation (manual / smoke).** `hey-listen analyze …` end to end needs the
  platform event loop (a display), exactly like the app and the `--mcp` path, so it is
  verified by hand on macOS (as `--mcp` is) rather than in `cargo test`. It is not part
  of the wdio suite, which drives the GUI. See [`testing.md`](testing.md).
