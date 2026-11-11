# Batch CLI (`hey-listen-cli`)

A **plain console binary** that runs the analysis engine over files without opening or
driving a window — so a shell script or CI job can do bulk analysis, build project
files (source + setup + tabs, and a saved comparison), upgrade project files in place,
and read the results as JSON. It
is the non-MCP sibling of the headless MCP server: the same engine, a friendlier calling
convention.

Delivered in **M10** as a subcommand of the app binary; rehosted as the console binary
in **M33.B** ([`roadmap.md`](roadmap.md) → M33.B, [`decisions.md`](decisions.md) →
**ADR-29**). The batch logic lives in `src-tauri/cli/src/batch/`; the interface is
parsed by `clap` derive in `src-tauri/cli/src/batch/clap_args.rs`, and the binary is its
own crate — `src-tauri/cli/` (package `hey-listen-cli`), which links the app crate as a
library (so it is not a bin target of the app package; see
[`packaging.md`](packaging.md)).

## Why a console binary

ADR-14 put the batch CLI in the app binary because the interface was declared with
`tauri-plugin-cli`, whose `Cli` cannot be constructed outside a running app. That made
every batch command pay full app boot: scripts inherited the log plugin's sandbox abort
and log-file race, a bare GUI-less host could not run it at all, and on Windows the app
binary has no console so stdout was lost.

- **`hey-listen-cli`** is that fix: a console program like `heylisten-mcp`. It builds the
  parser with `clap` derive, maps the matches onto the same batch `Request`, and runs
  the same headless session — **no Tauri app, no window, no log plugin**.
- The JSONL envelope and the exit codes are **unchanged**: the console binary is a
  rehost, not a behaviour change. `cli/src/batch/tests/console.rs` resolves a representative
  command set through both parsers and asserts the same `Request` and the same JSONL
  bytes.
- The app binary keeps only `--mcp` / `--headless` (and the `.heyl` open path) via
  `tauri-plugin-cli`; the batch subcommands are not declared there, so
  `hey-listen analyze …` is just an argument it rejects.
- `heylisten-mcp` stays a **separate plain console binary**: it is an MCP stdio server,
  not the batch CLI (see its module docs).

> **Not to be confused with** `heylisten-mcp`: that is an MCP **stdio server** (a
> client speaks JSON-RPC to it). This CLI is a **command** you run in a shell and read
> JSON from. They share the engine session (below) but are different interfaces. The
> CLI is *deliberately not* a bridge — unlike `heylisten-mcp`, it never attaches to a
> running app: a batch job must be deterministic and must not drive the user's window.

## Shape

```text
  shell / CI                       hey-listen-cli (console binary)   engine session
  ┌──────────┐  argv + files   ┌───────────────────────────┐  same calls ┌──────────────┐
  │  bash    │ ──────────────► │ clap derive → Request      │ ──────────► │  headless    │
  │  jq      │ ◄────────────── │  batch::run                │ ◄────────── │  session     │
  └──────────┘   JSONL stdout  └───────────────────────────┘             └──────┬───────┘
                                   (no Tauri app, no window)                   │
                                                      audio::decode / analysis::run_window
                                                      audio::graph / audio::analyzers
```

The binary is thin: it parses, maps, runs, flushes, and exits (`exit::finish`). The app
binary's `setup` resolves only `--mcp` vs the GUI; the batch subcommands are not
declared there any more.

The batch command is a thin front end: it maps the parsed args onto the **same**
operations the headless MCP server runs (`open_audio_file`, `run_analysis`,
`set_shared_params`, `set_tool_options`, `render_synth`, `list_analyzers`), through the
one shared headless session. So there is no third DSP path — the GUI command, the
headless MCP server, and the CLI all reach `analysis::run_window` and the other engine
functions.

## Migration & discovery

`hey-listen analyze …` is **removed** (ADR-29). Scripts should call the console binary;
resolve it in this order so a developer checkout, an install and CI all work:

1. `HEY_LISTEN_CLI` — explicit path to `hey-listen-cli` (new scripts).
2. `HEY_LISTEN_BIN` — the old variable, still honoured: when it points at the app
   binary (`hey-listen`), use its sibling `hey-listen-cli`.
3. `hey-listen-cli` on `PATH` — what the app's *Install Command Line Tool…* menu action
   writes (M33.D).
4. The app bundle's sidecar beside the installed app (it ships as
   `bundle.externalBin`, see [`packaging.md`](packaging.md)).

```bash
CLI="${HEY_LISTEN_CLI:-${HEY_LISTEN_BIN:+$(dirname "$HEY_LISTEN_BIN")/hey-listen-cli}}"
CLI="${CLI:-$(command -v hey-listen-cli)}"
"$CLI" analyze *.wav -t levels | jq -c '{file, summary: .summary.text}'
```

The only app-binary spellings left are `hey-listen --mcp` / `--headless` (the MCP entry)
and `hey-listen <FILE.heyl>` (open a project in the GUI).

## Commands

```text
hey-listen-cli <COMMAND>

Commands:
  analyzers [ID] [--json]   List the analyzer catalog, or explain one analyzer
  analyze  <FILE>...        Decode file(s) and run analyzer(s) over them
  compare  <A.heyl> <B.heyl> Diff one analyzer across two project files
  project  <OUT.heyl>       Build a .heyl project (source + setup + tabs), no window
  synth    <GRAPH.json>     Render a synth graph and (optionally) analyze the result
  annotations <FILE.heyl>   List or edit the annotations in a project file
  migrate  <FILE.heyl>...   Upgrade project files to the current format version

Options:
  -h, --help
  -V, --version
```

The app binary is unchanged in shape, minus the subcommands:

```text
hey-listen [--mcp] [--headless] [FILE.heyl]
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
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable), using the same keys MCP's `set_tool_options` takes (`nMels`, `nMfcc`, `nBands`, `rolloffPercent`, `yinThreshold`, `minF0Hz`/`maxF0Hz`, `barLength`, `windowMs`, `frameMs`/`hopMs`, `gateDb`/`gateFloorDb`, `hysteresisDb`, `minNoteMs`/`minGapMs`, `syllableGapMs`, `fMinHz`/`fMaxHz`). Canonical camelCase is preferred; snake_case aliases (`min_f0_hz`, `n_mels`, …) are accepted and canonicalized. An unknown key fails. **Name the tool** when several are run (`-o mfcc.nMfcc=13`); a bare `-o K=V` is scoped to the sole `--tool`. The tool must be named with several tools because neither parser reports the interleaved order of `-t` and `-o` flags. Run `analyzers <ID>` to print a tool's keys, defaults, ranges, and help. |
| `--filter <FILE>` | Apply a filter `GraphSpec` (JSON) before analysis. |
| `--full` | Include the raw result arrays (default: compacted — see below). The `summary` is present in both modes. |
| `--summary` | Emit the summary only (`{ file, window, params, options, summary }`), without result arrays. Mutually exclusive with `--full`. **(M21)** |
| `--pretty` | Pretty-print a single result instead of one JSON line per result. |
| `--fail-fast` | Stop at the first failing file/tool (default: run the whole batch and report). |
| `--format <json\|csv>` | Output format. `json` (the default) keeps the JSONL shape below on stdout; with `--out` it writes a **provenance envelope** per result. `csv` is a **wide matrix** for the 2D tools, plus a `.meta.json` sidecar. `--csv` is shorthand. **(M12)** |
| `--out <FILE\|DIR>` | Write to a file (exactly one result) or a directory (one file per result, `<source>.<tool>.<ext>`) instead of stdout. **(M12)** |
| `--template <FILE.heyltemplate>` | Apply a template's shared params, per-tool options, filter graph, and window policy before running (M13, planned). |

Analyzer ids are **not** enumerated in the clap definition (that would duplicate the
catalog in Rust); an id that is not in `audio/analyzers.rs` produces one `error` line per
file and exit `1` (`{"file":…,"tool":…,"error":"unknown analyzer: …"}`), and the run
continues with any known ids. A malformed `K=V`, an unknown param/option key, an option
that does not belong to its tool or is outside the catalog range, a missing file or `-t`,
a bad `--seconds`/`--start`/`--end` value, or a `--pretty` stream that is not a single
result is a **usage error** (printed to stderr, exit `2`).

**Scale.** Use the batch CLI for **many files**; use one headless MCP session or
`analyze --windows FILE` for **many windows in one file**, so a 1k-window run pays one
process startup, not 1k. `--windows` keeps the JSONL contract: one line per
file/window/tool, and the envelope's `window` says which span each line covers.

### `compare <A.heyl> <B.heyl>` (M25)

Run the **same analyzer** over two saved projects and emit the two results plus an
explicit comparison (see [`comparison.md`](comparison.md)). Each side uses its own
saved setup — analysis window, shared params, tool options, `filterEnabled` and
`LAYOUT.filterSpec` — so the diff is "the projects as saved". Matching is **relative**
(each side starts at 0) and the delta covers the common span; `--overlap` opts into the
older absolute-intersection behavior.

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id (repeatable; one output line per tool). Required unless `--all`. |
| `--all` | Compare every analyzer in the catalog. |
| `--start` / `--end` | Override **both** sides' windows. |
| `--a-start` / `--a-end` / `--b-start` / `--b-end` | Override one side's window. |
| `--b-offset <SECS>` | Move side B on the relative axis (positive = later). Default `0`. A **negative** value must be one token — `--b-offset=-0.25` — because the option parser reads a bare `-0.25` as a flag. **(M25.B)** |
| `--overlap` | Clip both sides to their absolute-time intersection before comparing. |
| `-p, --param <K=V>` | Patch a shared param on **both** sides. |
| `-o, --option [TOOL.]K=V` | Patch a per-tool option on **both** sides. |
| `--filter <FILE>` | Override both saved filters with this `GraphSpec`. |
| `--full` / `--summary` | Raw result/delta arrays, or summaries + diff stats only. |
| `--save <OUT.heyl>` | Write **owner A** back to this path with the reference snapshots, so the app reopens the comparison as a compare tab **(M25.D)**. A reference project stays a reference; anything else embeds the decoded audio. |
| `--open-tool <ID>` | With `--save`, override the saved project's Workbench tabs (repeatable). |
| `--pretty` / `--fail-fast` | As in `analyze`. |

One JSONL object per tool (the `analyze` result envelope per side plus the comparison):

```json
{"tool":"spectrum",
 "a":{"file":"a.heyl","window":{},"params":{},"options":{},"summary":{},"result":{}},
 "b":{"file":"b.heyl","…":"…"},
 "comparability":{"aligned":true,"alignment":{},"overlap":{},"mismatches":[],
                  "filtersDiffer":false},
 "diff":{"kind":"spectrum","summary":"…","maxAbs":4.2}}
```

`diff` is absent when the grids differ (a mismatch list explains why); the two results
are still emitted. `alignment` carries `{ aDuration, bDuration, bOffset, common }`, the
relative span the delta covers. Every analyzer id compares, and the GUI charts every
family too (M25.A). Exit `0` when every tool ran, `1` when either side failed, `2` on a
usage error. A project saved before `LAYOUT.filterSpec` existed compares unfiltered with
a one-line stderr warning. **Only project files** are accepted — `analyze` covers raw
audio files. Comparing a **single** file against its saved snapshot (M25.C) is a
follow-up (the headless MCP server already does it with
`compare_analysis { saved: true }`, M25.D).

With `--save`, the owner's setup stores the diff's **effective** settings (the
`-p` / `-o` / `--start` / `--end` / `--filter` overrides included), so reopening it
reproduces the comparison instead of a silently different one. stdout stays pure
JSONL; the saved path is reported on stderr.

> **Delivered (M25).** `cli/src/batch/compare.rs` loads both project files itself (each side
> gets its own `WindowState` with the saved PCM — or the referenced file — and
> `LAYOUT.filterSpec`), then runs `analysis::compare::compare` per tool. `--windows` is
> rejected (a comparison has one window per side), `--out`/CSV are not offered, and the
> two positionals are declared in `cli/src/batch/clap_args.rs`. See [`roadmap.md`](roadmap.md) → M25.

### `analyzers [ID]`

| Option | Meaning |
| --- | --- |
| `ID` | Optional analyzer id. With it, print the description, about copy, option metadata (defaults / ranges / help), and summary keys. **(M21)** |
| `--json` | Emit the analyzer catalog (or the one analyzer) as JSON, matching MCP's `list_analyzers` / `get_analyzer`. Otherwise a plain table. |

### `annotations <FILE.heyl>` (M14; editing since M25.D)

List, get, add, update or delete the **annotations** stored in a project file, without a window
(see [`annotations.md`](annotations.md)). The annotation shape is the same one MCP's `save_project` takes:
`title`, `body`, `timeSecs`, optional `range` / `tool`.

| Option | Meaning |
| --- | --- |
| `--json` | List: emit each annotation as one JSON line (JSONL) instead of a table. |
| `--full` | List: widen the **table** label to the whole markdown body (default: a one-line excerpt). `--json` records always carry the full `body`, so a script never loses it. |
| `--get <ID>` | Print one annotation (full body and frozen values). |
| `--add <FILE.json>` | Append the annotations in a JSON array file. |
| `--update <ID> --set FIELD=VALUE` | Patch one annotation. Fields: `title`, `body`, `timeSecs` (`time` / `at`), `range` (`start,end` seconds, an object, or `none`), `tool` (an analyzer id or `none`). `none` / `null` clears an optional field. |
| `--delete <ID>` | Remove one annotation. |
| `--to <FILE.heyl>` | Write a changed project to a **copy** instead of editing it in place (works with `--add` / `--update` / `--delete`). |

A file with no `ANNOTATIONS` section prints nothing and exits `0`; a missing / unreadable /
non-project file, an unknown id, or an invalid field is an `error` (exit `1`); a bad flag
or using flags together (`--json` with a mutation, two operations, `--to` without one) is
a usage error (exit `2`). Mutations rewrite the project **atomically** (a sibling temp
file renamed over it), preserving the source, setup, layout and saved comparisons — but
an open app does not watch the file, so **reload it** after an external edit.

```bash
# Add two annotations from a JSON array file:
hey-listen-cli annotations mix.heyl --add /tmp/annotations.json

# Rename one and give it a span, in place:
hey-listen-cli annotations mix.heyl --update n1 --set title="Third harmonic" --set range=2.5,2.9

# Print it back, or remove it:
hey-listen-cli annotations mix.heyl --get n1
hey-listen-cli annotations mix.heyl --delete n1

# Edit a copy:
hey-listen-cli annotations mix.heyl --add /tmp/annotations.json --to mix-annotated.heyl
```

The `analyze` / `synth` commands do **not** gain annotation flags — they run against files, not
projects, so there is nowhere to store an annotation.

### `project <OUT.heyl>` (M25.D)

Build a **project file** from a source + setup + tabs, with no window — the CLI face of
the headless MCP sequence `open_audio_file` / `render_synth` → `set_*` → `open_tool` →
`save_project`. The result opens in the app with the same source, setup, filter, annotations
and Workbench tabs. Nothing is analyzed unless you run `analyze` / `compare` separately.

| Option | Meaning |
| --- | --- |
| `--source <AUDIO>` | Decode this file as the project source (mutually exclusive with `--synth`). |
| `--synth <GRAPH.json>` | Render a synth graph as the source; `--seconds` sets its length (default 5). |
| `--name <NAME>` | Project display name (default: the output file stem). |
| `--open-tool <ID>` | Analyzer tab to restore when the project opens (repeatable). |
| `--annotations <FILE.json>` | Annotations to write: a JSON array of annotation objects (`title`, `body`, `timeSecs`, optional `range` / `tool`), the same shape MCP's `save_project` takes. |
| `--start` / `--end` | Analysis window (default `0` … full duration). |
| `-p` / `-o` / `--filter` | Shared params, per-tool options, and a filter `GraphSpec` saved into the project. Name the tool in `-o` (`-o mfcc.nMfcc=13`). |
| `--reference` | Write a reference project (no embedded audio) for a file source. |
| `--pretty` | Pretty-print the one saved-project record. |

Prints one JSON line (`{ path, name, embedded, annotations, openTools }`). Parent folders are
created. A failure to decode/render/save is an `error` line (exit `1`); bad arguments are
a usage error (exit `2`).

```bash
# An audio file plus the tabs and annotations to restore:
hey-listen-cli project call.heyl --source call.wav --open-tool noteMetrics \
  --open-tool spectrogram --annotations annotations.json --start 1.2 --end 3.4

# A project from a synth graph:
hey-listen-cli project demo.heyl --synth demo.json --seconds 2.5 --open-tool spectrum

# A reference project (keeps the SOURCE path, embeds no audio):
hey-listen-cli project call-ref.heyl --source call.wav --reference

# Compare two projects and save the diff into a copy of the owner:
hey-listen-cli compare a.heyl b.heyl -t spectrum --save a-with-comparison.heyl \
  --open-tool spectrum
```

### `migrate <FILE.heyl>...` (M37)

Upgrade project files to the **current format version**, in place. This is the script
surface of the loader's migration chain (see [`project-file-format.md`](project-file-format.md)
→ Migrations and ADR-32): it reads each file with the same `read_project` the app uses,
which migrates older payloads step by step in memory, and writes back through
`write_project_atomic`, so a bulk upgrade and an app save cannot diverge.

| Option | Meaning |
| --- | --- |
| `FILE.heyl` | One or more project files to upgrade. |
| `--embed` | Embed a **reference** project's audio (decode `SOURCE.path` into `DATA`). Without it a reference project stays a reference. |
| `--no-backup` | Do not keep the `<project>.heyl.bak` copy that a rewrite writes by default. |

One JSON line per file:

```json
{"file":"song.heyl","fromVersion":1,"toVersion":1,"migrated":false,
 "embedded":true,"backup":null,"dropped":[]}
```

A file already at the current version is left **untouched** — no rewrite, no backup —
unless `--embed` grows it. Analysis results are dropped by the upgrade (they are a cache,
recomputed on demand) and reported in `dropped`; source, audio, setup, graphs, annotations
and saved comparisons survive. A `.bak` is only written for a file that is rewritten.
Exit `0` when every file upgraded, `1` when any failed (one `error` record per failure),
`2` on a bad flag.

```bash
# Upgrade everything in a folder, keeping a .bak beside each rewritten file:
hey-listen-cli migrate projects/*.heyl

# Embed the referenced recordings too (larger files, no external dependency):
hey-listen-cli migrate projects/*.heyl --embed --no-backup
```

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
> stream, so the guarantee is also checked by hand (`hey-listen-cli analyzers | jq`).

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
way. `--pretty` prints a single (human-readable) JSON object — for one file / one tool,
and for a `synth` run without `-t` (its one source-summary record).

**Output failures are failures.** A write/flush that fails (a full destination, a closed
pipe) or a CSV export whose `.meta.json` provenance sidecar cannot be written exits
non-zero instead of reporting success with missing output.

**Exit codes:**

| Code | Meaning |
| --- | --- |
| `0` | Every file/tool succeeded. |
| `1` | At least one file/tool/analyzer id failed, the output could not be written (stdout, file or CSV sidecar), or `annotations` could not read the project (the failing line carries `error`). |
| `2` | Usage error (unknown subcommand/flag, bad `K=V`, missing `-t`). |

> **Usage errors exit `2` and stay off stdout.** `clap` reports `--help` / `--version`
> on stdout with exit `0` (they are not errors) and a genuine parse error on stderr with
> exit `2`. The request mapping's own rejections (bad `K=V`, missing `-t`, an unknown
> `-o` key) print `hey-listen-cli: …` to stderr and exit `2`. Unknown `-t` ids are the
> exception: they are not a usage error — they ride along to the run phase and become an
> `error` record plus exit `1`. The old app-binary spelling (`hey-listen analyze …`) now
> prints a one-line hint and exits `2` instead of launching the GUI.

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
hey-listen-cli analyze *.wav -t loudnessIntegrated | jq -c '{file, lufs: .result.lufs}'

# Every tool of one file, raw arrays, as JSONL to a file:
hey-listen-cli analyze mix.wav --all --full > mix.jsonl

# One result, pretty-printed:
hey-listen-cli analyze mix.wav -t spectrum --full --pretty > spectrum.json

# A 4 s window at 10 s with a big FFT, two tools, one file:
hey-listen-cli analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Many windows in one file, one process (one `start,end[,tool…]` per line):
hey-listen-cli analyze call.wav -t noteMetrics --windows windows.txt > call.jsonl

# Gate a series to drop the recording's background before measuring it:
hey-listen-cli analyze call.wav -t spectralCentroid -o spectralCentroid.gateDb=20 --full

# Per-tool options are named: a 40-band mel spectrogram then MFCCs:
hey-listen-cli analyze a.wav -t melSpectrogram -o melSpectrogram.nMels=40 -t mfcc -o mfcc.nMfcc=13

# Note segmentation with a tighter gate and the full note records:
hey-listen-cli analyze call.wav -t noteMetrics -o noteMetrics.gateDb=25 --full

# AM/FM modulation spectra over a 0.5–80 Hz band (full spectra):
hey-listen-cli analyze call.wav -t modulation -o modulation.modMaxHz=80 --full

# Discover ids:
hey-listen-cli analyzers --json | jq -r '.[].id'

# Explain one analyzer's options and summary keys:
hey-listen-cli analyzers noteMetrics

# Sweep with summaries only:
hey-listen-cli analyze *.wav -t levels --summary | jq -c '{file, summary}'

# Show the annotations in a saved project (JSONL, full bodies):
hey-listen-cli annotations mix.heyl --json --full | jq -c '{time: .timeSecs, tool, values: .values.text}'

# Filter, then analyze, over a whole folder:
hey-listen-cli analyze ./takes/*.wav -t levels --filter lp.json | jq -c '{file, peak:.result.peakDb}'
```

## Scope and non-goals

In scope (the **engine-backed compute subset**, matching headless MCP):

- `analyzers`, `analyze`, `synth` — decode a file, run analyzers, render a synth
  graph, list the catalog, with shared params / per-tool options / a filter graph.
- `annotations` — list **and edit** a saved project's annotations (M14; get/add/update/delete since
  M25.D).
- `compare` — diff two project files, optionally saving the reference snapshots back
  into the owner (`--save`, M25.D).
- `project` — build a `.heyl` from a file or synth source with the analysis setup,
  filter, annotations and Workbench tabs to restore (M25.D). Nothing needs a window.
- `migrate` — upgrade `.heyl` files to the current format version, atomically and with a
  `.bak` (M37).

Planned in the compute subset (M13):

- `--template` to apply a saved setup before analysis. The **chart-PNG** export is
  GUI-only and is not offered here. See [`templates.md`](templates.md).

Delivered in the compute subset (M12):

- **Data exports** — `--format csv` / `--out` share the **same Rust renderer** the UI
  uses, so the CLI and the app emit byte-identical CSV and JSON envelopes. A CSV
  written by `--out` also writes its `<name>.meta.json` sidecar. See
  [`exports.md`](exports.md).

Planned in the compute subset (M21):

- ~~`analyzers <ID>` and `--summary`~~ — delivered in M21: per-analyzer option/help
  discovery and a summary-only output mode, plus the canonical `summary` in every
  envelope. See [`mcp-cli-ergonomics.md`](mcp-cli-ergonomics.md).

Deliberately out of scope:

- **UI-only tools** — Workbench tabs, editor-layout graph editing, and live
  preview/capture. These need the app's windows (see [`mcp.md`](mcp.md) →
  Limitations). Project save/open is **not** a CLI subcommand, but it is available
  through the headless MCP server (`heylisten-mcp --headless`), which writes the
  session's source + setup + annotations.
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
| `src-tauri/cli/src/main.rs` | the console binary (the `hey-listen-cli` crate): parse, run, flush, exit (`exit::finish`). |
| `src-tauri/cli/src/batch/clap_args.rs` | the `clap` derive interface and its `ArgMatches` → `Request` mapping. |
| `src-tauri/cli/src/batch/` | the batch logic: `Request` (from either parser) → the headless session; JSONL output; unit tests (`analyze` / `synth` / `analyzers` / `annotations` / `migrate` / `console`). |
| `src-tauri/src/cli/mod.rs` | the app binary's two flags + the `setup` entry (`--mcp` → MCP, else GUI). |
| `src-tauri/src/mcp/dispatch/` | the headless session, reused (the shared engine facade; `set_filter_graph` lives here). |
| `src-tauri/src/audio/{decode,analyzers}.rs`, `src-tauri/src/audio/{analysis,graph}/` | the engine functions the batch command calls. |
| `scripts/prepareSidecar.mjs` | stages `src-tauri/binaries/hey-listen-cli-<triple>` for `bundle.externalBin` (`npm run sidecar`). |

## Testing

- **Batch logic (display-free).** The command's work is a plain function
  (`batch::run`) over a crate-local `Request` (command, files, tools, params,
  options, window, `--full`/`--pretty`/`--fail-fast`), so `cargo test` exercises it with
  no Tauri app and no display: it runs over a generated sine WAV and asserts `spectrum`'s
  peak is near 440 Hz, two files print two lines, an unknown tool yields an `error` line
  + exit `1`, a missing file fails without a `tool`, `synth` renders and reports a
  summary, and `analyzers` prints the catalog as JSON or a table. `migrate` is covered
  too: a current file is not rewritten byte-for-byte, `--embed` grows a reference project
  and keeps a `.bak`, and a missing file is an `error` record.
- **Arg mapping.** The one mapping (`batch::build_request`) is asserted two ways:
  through the **real parser** (`clap_args::request`, in `cli/src/batch/tests/console.rs`) and
  through synthetic `tauri-plugin-cli` matches (the retired `plugins.cli` surface, kept
  as the reference). The consistency tests resolve a representative command set through
  both and assert the same `Request` and the same JSONL bytes, so the two cannot drift.
- **Binary invocation (manual / smoke).** `hey-listen-cli analyze …` is a plain console
  program: build it (`cargo build -p hey-listen-cli` from `src-tauri/`) and run it — it
  needs no display. It is not part of the wdio suite, which drives the GUI. See
  [`testing.md`](testing.md).
