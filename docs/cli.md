# Batch CLI (`hey-listen analyze`)

A **subcommand of the app binary** that runs the analysis engine over files without
opening or driving a window — so a shell script or CI job can do bulk analysis and
read the results as JSON. It is the non-MCP sibling of the headless MCP server: the
same engine, a friendlier calling convention.

This is delivered (**M10**). The batch logic lives in `src-tauri/src/cli/batch/`;
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
  analyzers [ID]  List the analyzer catalog, or explain one analyzer
  analyze         Decode file(s) and run analyzer(s) over them
  synth           Render a synth graph and (optionally) analyze the result
  notes           List the notes in a project file (.heyl)

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
| `--windows <FILE>` | Run a **list of windows** in one process: one `start,end[,tool,tool…]` per line, `#` comments allowed. A line without tools uses `-t` / `--all`. Mutually exclusive with `--start`/`--end`. **(M21.B)** |
| `-p, --param <K=V>` | Patch a **shared** param (repeatable), using the same keys MCP's `set_shared_params` takes: `fftSize`, `hop`, `windowFn` (`hann`/`hamming`/`blackman`/`rectangular`), `channel`, `resampleTo`, `freqMinHz`, `freqMaxHz`, `randomizedOverlap`. |
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable), using the same keys MCP's `set_tool_options` takes (`nMels`, `nMfcc`, `nBands`, `rolloffPercent`, `yinThreshold`, `minF0Hz`/`maxF0Hz`, `barLength`, `windowMs`, `frameMs`/`hopMs`, `gateDb`/`gateFloorDb`, `hysteresisDb`, `minNoteMs`/`minGapMs`, `syllableGapMs`, `fMinHz`/`fMaxHz`). Canonical camelCase is preferred; snake_case aliases (`min_f0_hz`, `n_mels`, …) are accepted and canonicalized. An unknown key fails. **Name the tool** when several are run (`-o mfcc.nMfcc=13`); a bare `-o K=V` is scoped to the sole `--tool`. The tool must be named with several tools because the plugin's parsed matches do not preserve the order of flags on the command line. Run `analyzers <ID>` to print a tool's keys, defaults, ranges, and help. |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--full` | Include the raw result arrays (default: compacted — see below). The `summary` is present in both modes. |
| `--summary` | Emit the summary only (`{ file, window, params, options, summary }`), without result arrays. Mutually exclusive with `--full`. **(M21)** |
| `--pretty` | Pretty-print a single result instead of one JSON line per result. |
| `--fail-fast` | Stop at the first failing file/tool (default: run the whole batch and report). |
| `--format <json\|csv>` | Output format (default `json`, the JSONL shape below); `--csv` is shorthand. CSV is a **wide matrix** for the 2D tools (M12, planned). |
| `--out <FILE\|DIR>` | Write to a file (a single result) or a directory (one file per result) instead of stdout (M12, planned). |
| `--template <FILE.heyltemplate>` | Apply a template's shared params, per-tool options, filter graph, and window policy before running (M13, planned). |

Analyzer ids are **not** enumerated in `plugins.cli` (that would duplicate the catalog
in JSON); they are validated by the engine against `audio/analyzers.rs` when they run, so
an unknown id produces one `error` line and exit `1` (`{"file":…,"tool":…,"error":"unknown analyzer: …"}`).
A malformed `K=V`, an unknown param/option key, a missing file or `-t`, a bad
`--seconds`/`--start`/`--end` value, or a `--pretty` stream that is not a single result is
a **usage error** (printed to stderr, exit `2`) — it never falls through to the GUI.

**Scale.** Use the batch CLI for **many files**; use one headless MCP session or
`analyze --windows FILE` for **many windows in one file**, so a 1k-window run pays one
process startup, not 1k. `--windows` keeps the JSONL contract: one line per
file/window/tool, and the envelope's `window` says which span each line covers.

### `analyzers [ID]`

| Option | Meaning |
| --- | --- |
| `ID` | Optional analyzer id. With it, print the description, about copy, option metadata (defaults / ranges / help), and summary keys. **(M21)** |
| `--json` | Emit the analyzer catalog (or the one analyzer) as JSON, matching MCP's `list_analyzers` / `get_analyzer`. Otherwise a plain table. |

### `notes <FILE.heyl>`

List the **notes** stored in a project file, sorted by time (M14; see
[`notes.md`](notes.md)). Read-only — it decodes the container, reads the `NOTES` section,
and never mutates the file.

| Option | Meaning |
| --- | --- |
| `--json` | Emit each note as one JSON line (JSONL) instead of a table. |
| `--full` | Include the full markdown body (default: a one-line excerpt). |

A file with no `NOTES` section prints nothing and exits `0`; a missing / unreadable /
non-project file is an `error` (exit `1`), and a bad flag is a usage error (exit `2`).
The `analyze` / `synth` commands do **not** gain note flags — they run against files, not
projects, so there is nowhere to store a note.

### `synth <GRAPH.json>`

Render a synth graph to PCM (mono, `48 kHz`, `--seconds` default `5`), then behave
exactly like `analyze` on the rendered source. With no `-t` (and no `--all`), it prints
the rendered source's summary as one line — `{"file": <GRAPH.json>, "source": { "sampleRate", "channels", "frames", "duration", … }}`.

| Option | Meaning |
| --- | --- |
| `--seconds <SEC>` | Rendered length (default `5`). |
| *(analyze options)* | `-t` / `-p` / `-o` / `--filter` / `--full` / `--summary` / `--pretty` / `--fail-fast` as above. |

The graph is the same `{ "nodes": [...], "edges": [...] }` `GraphSpec` the headless
MCP `render_synth` takes — there is no graph *editor* here, so the graph is always
given as a file.

## Output

**JSONL by default** — one self-describing object per line, so `jq -c` streams it:

```json
{"file":"a.wav","window":{"start":0.0,"end":2.5},"params":{"...":0},"options":{"...":0},"summary":{"tool":"spectrum","label":"Spectrum","text":"peak 440 Hz · level -6 dBFS · frames 43","items":[{"...":0}]},"result":{"tool":"spectrum","peakHz":440.0,"...":0}}
```

**stdout is only the JSONL.** Logs (including the app's start-up line and the E2E
WebDriver preamble) go to **stderr** and the log file; a pipe can parse every line.

> **M21.A:** the log target used to be stdout, so a `[WDIO]` / `hey-listen x.y.z
> starting` preamble preceded the JSON and every consumer had to filter lines starting
> with `{`. That is fixed; the batch unit tests inject `out` and cannot see the process
> stream, so the guarantee is also checked by hand (`hey-listen analyzers | jq`).

The object is exactly what MCP's `run_analysis` returns (`window`, `params`, `options`,
`summary`, `result` — the `tool` tag rides on `result`) with the `file` added. Every mode
carries the canonical **`summary`** (a stable `text` line plus labelled, unit-bearing
items). Results are **structurally compact** by default: matrices and spectrograms keep
their dimensions and peak location, numeric series become `{length,min,max,argmin,argmax,hop}`
(with `nulls` for gaps), and event/note arrays keep a bounded five-record preview
(`noteMetrics` also carries `bounds`, every detected span). This
is the same Rust shaper MCP uses, so a spectrogram does not flood the terminal;
`--full` returns the raw arrays and `--summary` drops them entirely. `--full` always
spells time axes as arrays (use MCP's `axis: "compact"` for the compact form, or
`--summary` when only the answer matters).

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
| `1` | At least one file/tool failed, or `notes` could not read the project (the failing line carries `error`). |
| `2` | Usage error (unknown subcommand/flag, bad `K=V`, missing `-t`). |

> **Usage errors must not silently open the GUI.** `plugins.cli` parsing reports a
> `DisplayHelp` / `DisplayVersion` as a `help` / `version` arg (printed, exit `0`), but a
> genuine parse error comes back as `Err`. `cli::parse` treats a parse error as "no
> flags" so a `.heyl` path still opens (the file-association path) — *unless* the first
> positional token names a batch subcommand (`subcommand_in_argv`), in which case the
> error is printed to stderr and the process exits `2` instead of launching the app.
> A `Mapping` error (bad `K=V`, missing `-t`, an unknown `-o` key) is likewise an
> `Entry::Usage`: printed and exited `2`.

### M21 — ergonomics

The batch output carries a canonical `summary` in every mode, and analyzer discovery
lives in the command. See [`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

- **Default:** compact `result` + `summary`.
- **`--summary`:** `{ file, window, params, options, summary }` — no result arrays, so a
  large sweep stays readable and `jq`-friendly. This is the CLI counterpart of MCP's
  `summaryOnly`.
- **`--full`:** raw arrays + `summary`.
- **`analyzers <ID>`:** the per-analyzer option keys/defaults/help, so `-o` no longer
  requires the docs.
- **Compact previews:** event/note arrays keep a bounded preview rather than collapsing
  to `{ length }`; matrices/spectrograms keep dimensions and peak location.

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

# Many windows in one file, one process (one `start,end[,tool…]` per line):
hey-listen analyze call.wav -t noteMetrics --windows windows.txt > call.jsonl

# Gate a series to drop the recording's background before measuring it:
hey-listen analyze call.wav -t spectralCentroid -o spectralCentroid.gateDb=20 --full

# Per-tool options are named: a 40-band mel spectrogram then MFCCs:
hey-listen analyze a.wav -t melSpectrogram -o melSpectrogram.nMels=40 -t mfcc -o mfcc.nMfcc=13

# Note segmentation with a tighter gate and the full note records:
hey-listen analyze call.wav -t noteMetrics -o noteMetrics.gateDb=25 --full

# AM/FM modulation spectra over a 0.5–80 Hz band (full spectra):
hey-listen analyze call.wav -t modulation -o modulation.modMaxHz=80 --full

# Discover ids:
hey-listen analyzers --json | jq -r '.[].id'

# Explain one analyzer's options and summary keys:
hey-listen analyzers noteMetrics

# Sweep with summaries only:
hey-listen analyze *.wav -t levels --summary | jq -c '{file, summary}'

# Show the annotations in a saved project (JSONL, full bodies):
hey-listen notes mix.heyl --json --full | jq -c '{time: .timeSecs, tool, values: .values.text}'

# Filter, then analyze, over a whole folder:
hey-listen analyze ./takes/*.wav -t levels --filter lp.json | jq -c '{file, peak:.result.peakDb}'
```

## Scope and non-goals

In scope (the **engine-backed compute subset**, matching headless MCP):

- `analyzers`, `analyze`, `synth` — decode a file, run analyzers, render a synth
  graph, list the catalog, with shared params / per-tool options / a filter graph.
- `notes` — read a saved project's notes (M14; read-only).

Planned in the compute subset (M12/M13):

- **Data export formats** — `--format csv` and `--out`, sharing the **same wide-matrix
  renderer** the UI uses (so the CLI and the app emit byte-identical CSV), and
  `--template` to apply a saved setup before analysis. The **chart-PNG** export is
  GUI-only and is not offered here. See [`exports.md`](exports.md) and
  [`templates.md`](templates.md).

Planned in the compute subset (M21):

- ~~`analyzers <ID>` and `--summary`~~ — delivered in M21: per-analyzer option/help
  discovery and a summary-only output mode, plus the canonical `summary` in every
  envelope. See [`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

Deliberately out of scope:

- **UI-only tools** — Workbench tabs, editor-layout graph editing, and live
  preview/capture. These need the app's windows (see [`mcp.md`](mcp.md) →
  Limitations). Project save/open is **not** a CLI subcommand, but it is available
  through the headless MCP server (`heylisten-mcp --headless`), which writes the
  session's source + setup + notes.
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
| `src-tauri/src/cli/batch/` | the batch logic: `Matches` → a request → the headless session; JSONL output; unit tests (`analyze` / `synth` / `analyzers` / `notes`). |
| `src-tauri/src/mcp/dispatch/` | the headless session, reused (the shared engine facade; `set_filter_graph` lives here). |
| `src-tauri/src/audio/{decode,analyzers}.rs`, `src-tauri/src/audio/{analysis,graph}/` | the engine functions the batch command calls. |

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
