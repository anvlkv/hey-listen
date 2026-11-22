# Batch CLI (`hey-listen-cli`)

Run this from a **terminal** (shell) for headless batch/CI — it is **not** an MCP tool and
there is no tool to "call" it. It runs the engine over files with no window, printing one
JSON object per file/tool. Deterministic. Logs go to **stderr**, so **stdout is pure JSONL**.

```text
hey-listen [OPTIONS] [FILE.heyl]
hey-listen <COMMAND>

Commands:
  analyzers [ID] [--json]   catalog, or one analyzer's options + summary keys
  analyze                   open audio file(s) or .heyl project(s) and run analyzers over them
  nodes [KIND] [--json]     list the filter/synth node catalog, or explain one kind (DOT skeleton)
  synth                     render a synth graph, then (optionally) analyze it
  annotations               list or edit annotations in a project file (.heyl)
  compare A.heyl B.heyl     diff one analyzer across two saved projects (--save writes it)
  project OUT.heyl          build a project from a source + setup + tabs, no window

Options:
  -m, --mcp      run the stdio MCP entry instead of the GUI
      --headless (with --mcp) force the core-native headless MCP server
```

## `analyze <FILE>...`

Each input is an **audio file** (decoded as the source) or a saved **`.heyl` project** (its
source + saved window/params/options are loaded). `-p` / `-o` / `--filter` overrides win over
a project's saved setup; the saved window is used when `--start`/`--end` are absent.

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable; required unless `--all`. |
| `--all` | Run every analyzer. |
| `--start <SEC>` / `--end <SEC>` | Window (default `0` / full duration). |
| `--windows <FILE>` | Many windows in one process: one `start,end[,tool…]` per line (`#` comments). Not with `--start`/`--end`. |
| `-p, --param <K=V>` | Patch a **shared** param (repeatable): `fftSize`, `hop` (fraction of `fftSize`), `windowFn`, `channel`, `resampleTo`, `freqMinHz`, `freqMaxHz`, `randomizedOverlap`. |
| `-o, --option [TOOL.]K=V` | Patch a **per-tool** option (repeatable). `-o mfcc.nMfcc=13`; bare `-o K=V` scopes to the sole `--tool`. **Run `analyzers <ID>` for exact keys/defaults/ranges.** |
| `--filter <FILE\|DOT>` | Apply a filter graph (DOT file/string; legacy JSON accepted) before analysis. |
| `--summary` / `--full` | Summary only / raw arrays (default compact). Mutually exclusive. |
| `--pretty` | Pretty-print a single result. |
| `--fail-fast` | Stop at the first failure (default: run the whole batch). |
| `--format <json\|csv>` / `--csv` / `--out <FILE\|DIR>` | Data export: JSON envelope or wide-matrix CSV (+ `.meta.json`); write to file/dir. |

**Scale:** many **files** → batch CLI. Many **windows in one file** → `--windows FILE` or
one headless MCP session.

## `nodes [KIND]`

List the filter/synth node catalog, or explain one kind. Mirrors MCP `list_nodes` /
`get_node` — the graph-authoring catalog; see [`graphs.md`](graphs.md) for the model and
sound design.

| Option | Meaning |
| --- | --- |
| `KIND` (positional) | One node kind to explain (default: list the catalog). |
| `--json` | Emit the catalog (or one kind) as JSON instead of a table. |

- No `KIND`: a table of every kind — `kind`, `category`, `inputs→outputs` (port counts),
  `label`.
- With `KIND`: that kind's detail — label/category, hint, input/output **port names**, each
  param (`key`, `label`, `default`, `min…max`, `step`, `unit`), and a **ready-to-paste DOT
  skeleton** with every param at its default. Use it instead of guessing a port or a key.

```bash
hey-listen-cli nodes                  # every kind
hey-listen-cli nodes lowpass          # one kind + DOT skeleton
hey-listen-cli nodes --json | jq -r '.[].kind'
```

## `synth <GRAPH>`

Render a synth graph to 48 kHz mono, adopt it as the source, then (optionally) analyze it —
the CLI face of the headless `render_synth` → analyze sequence.

| Option | Meaning |
| --- | --- |
| `GRAPH` (positional) | The synth graph: a `.dot`/`.gv` file, DOT text, or a legacy JSON `GraphSpec`. |
| `--seconds <SEC>` | Rendered length (default 5). |
| `-t` / `--all` / `--start` / `--end` | Same as `analyze` (run analyzers over the rendered source). |
| `-p` / `-o` / `--filter` | Same as `analyze` (params, per-tool options, a filter graph). |
| `--summary` / `--full` / `--pretty` / `--format` / `--csv` / `--out` | Same as `analyze`. |

With **no `-t` and no `--all`**, `synth` reports the rendered source summary instead of
analyzing it. With tools, each line is the same `{ tool, window, params, options, summary,
result }` envelope `analyze` prints (the `file` is the rendered source).

```bash
# Render a pad and read its loudness:
hey-listen-cli synth 'digraph { node[shape=record]; s[kind="sine", freq=220]; o[kind="output"]; s -> o; }' \
    -t loudnessIntegrated

# Discover the node catalog, then author from a skeleton:
hey-listen-cli nodes pluck
hey-listen-cli synth pluck.dot -t noteMetrics --seconds 3
```

## `compare <A.heyl> <B.heyl>`

Diff **the same analyzer** across two saved projects, each using its own saved window,
params, options, filter. Matching is **relative** (each side starts at 0); `--overlap` opts
into the old absolute-intersection rule.

| Option | Meaning |
| --- | --- |
| `-t, --tool <ID>` | Analyzer id; repeatable. Required unless `--all`. |
| `--all` | Every analyzer. |
| `--start` / `--end` | Override both sides' windows. |
| `--a-start` / `--a-end` / `--b-start` / `--b-end` | Override one side's window. |
| `--b-offset <SECS>` | Move side B on the relative axis (positive = later; default `0`). |
| `--overlap` | Clip both sides to their absolute-time intersection. |
| `-p` / `-o` / `--filter` | Patch params/options, or override saved filters, on both sides. |
| `--full` / `--summary` | Delta arrays, or summaries + diff stats only. |
| `--save <OUT.heyl>` | Write owner A with the reference snapshots (reopens as a compare tab). |
| `--open-tool <ID>` | With `--save`, override the saved project's tabs (repeatable). |

Each line is `{ tool, a, b, comparability, diff }`; `diff` is absent when the grids differ
(`comparability.mismatches` says why). `--save` stores the effective setup so reopening
reproduces it; the saved path goes to stderr.

## `project <OUT.heyl>`

Build a project file with no window — the CLI face of the headless
`open_audio_file`/`render_synth` → `set_*` → `open_tool` → `save_project` sequence.

| Option | Meaning |
| --- | --- |
| `--source <AUDIO>` / `--synth <GRAPH>` | The source (exactly one). `--seconds` sets a synth's length (default 5). |
| `--name <NAME>` | Display name (default: the output file stem). |
| `--open-tool <ID>` | Analyzer tab to restore (repeatable). |
| `--annotations <FILE.json>` | A JSON array of annotation objects (`title`, `body`, `timeSecs`, optional `range`/`tool`). |
| `--start` / `--end` | Analysis window (default 0 … full duration). |
| `-p` / `-o` / `--filter` | Shared params, per-tool options (`-o mfcc.nMfcc=13`), a filter graph (DOT file/string; legacy JSON accepted) saved into the project. |
| `--reference` | Keep only the file `SOURCE` path (no embedded audio). |

One JSON line: `{ path, name, embedded, annotations, openTools }`; parent folders created.

## `annotations <FILE.heyl>`

List or edit a project's annotations: `--json` / `--full` list, `--get <ID>`,
`--add <FILE.json>` (an array of annotation objects), `--update <ID> --set FIELD=VALUE`
(`title`, `body`, `timeSecs`/`time`/`at`, `range=start,end` or `none`, `tool=id` or `none`),
`--delete <ID>`. Mutations rewrite the project atomically; `--to <COPY.heyl>` edits a copy.
An open app does not watch the file — reload after editing.

## Output, exit codes, examples

| Exit | Meaning |
| --- | --- |
| `0` | Every file/tool succeeded. |
| `1` | At least one file/tool failed (failing line carries `error`). |
| `2` | Usage error (unknown subcommand/flag, bad `K=V`, missing `-t`). |

```bash
# One number per file:
hey-listen-cli analyze *.wav -t loudnessIntegrated | jq -c '{file, lufs: .result.lufs}'

# Sweep with summaries only:
hey-listen-cli analyze *.wav -t levels --summary | jq -c '{file, summary: .summary.text}'

# 4 s window at 10 s, big FFT, two tools:
hey-listen-cli analyze a.wav -t spectrum -p fftSize=8192 -t tempo --start 10 --end 14

# Many windows in one file, one process:
hey-listen-cli analyze call.wav -t noteMetrics --windows windows.txt > call.jsonl

# Gate a series to drop the recording's background:
hey-listen-cli analyze call.wav -t spectralCentroid -o spectralCentroid.gateDb=20 --full

# Discover ids, then explain one analyzer:
hey-listen-cli analyzers --json | jq -r '.[].id'
hey-listen-cli analyzers noteMetrics

# Diff two saved projects:
hey-listen-cli compare before.heyl after.heyl -t spectrum --summary
```
