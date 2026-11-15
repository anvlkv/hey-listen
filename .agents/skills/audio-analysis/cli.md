# Batch CLI (`hey-listen-cli`)

A subcommand of the app binary that runs the engine over files with no window and prints
one JSON object per file/tool. Deterministic; for shell/CI. Logs go to **stderr**, so
**stdout is pure JSONL**.

```text
hey-listen [OPTIONS] [FILE.heyl]
hey-listen <COMMAND>

Commands:
  analyzers [ID] [--json]   catalog, or one analyzer's options + summary keys
  analyze                   decode file(s) and run analyzer(s) over them
  synth                     render a synth graph, then (optionally) analyze it
  annotations               list or edit annotations in a project file (.heyl)
  compare A.heyl B.heyl     diff one analyzer across two saved projects (--save writes it)
  project OUT.heyl          build a project from a source + setup + tabs, no window

Options:
  -m, --mcp      run the stdio MCP entry instead of the GUI
      --headless (with --mcp) force the core-native headless MCP server
```

## `analyze <FILE>...`

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

## `compare <A.heyl> <B.heyl>`

Diff **the same analyzer** across two saved projects, each using its own saved window,
params, options and filter. Matching is **relative** (each side starts at 0); `--overlap`
opts into the old absolute-intersection rule.

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
| `--save <OUT.heyl>` | Write owner A with the reference snapshots (the app reopens it as a compare tab). |
| `--open-tool <ID>` | With `--save`, override the saved project's tabs (repeatable). |

Each line is `{ tool, a, b, comparability, diff }`; `diff` is absent when the grids differ
(`comparability.mismatches` says why). Project files only — `analyze` covers raw audio.
`--save` stores the diff's effective setup in the owner so reopening reproduces it; the
saved path goes to stderr.

## `project <OUT.heyl>`

Build a project file with no window — the CLI face of the headless
`open_audio_file`/`render_synth` → `set_*` → `open_tool` → `save_project` sequence.

| Option | Meaning |
| --- | --- |
| `--source <AUDIO>` / `--synth <GRAPH.json>` | The source (exactly one). `--seconds` sets a synth's length (default 5). |
| `--name <NAME>` | Display name (default: the output file stem). |
| `--open-tool <ID>` | Analyzer tab to restore (repeatable). |
| `--annotations <FILE.json>` | A JSON array of annotation objects (`title`, `body`, `timeSecs`, optional `range`/`tool`). |
| `--start` / `--end` | Analysis window (default 0 … full duration). |
| `-p` / `-o` / `--filter` | Shared params, per-tool options (`-o mfcc.nMfcc=13`), and a filter `GraphSpec` saved into the project. |
| `--reference` | Keep only the file `SOURCE` path (no embedded audio). |

One JSON line: `{ path, name, embedded, annotations, openTools }`; parent folders created.

## `annotations <FILE.heyl>`

List or edit a project's annotations with no window: `--json` / `--full` list,
`--get <ID>`, `--add <FILE.json>` (an array of annotation objects),
`--update <ID> --set FIELD=VALUE` (`title`, `body`, `timeSecs`/`time`/`at`,
`range=start,end` or `none`, `tool=id` or `none`), `--delete <ID>`. Mutations rewrite the
project atomically; `--to <COPY.heyl>` edits a copy. An open app does not watch the file
— reload after editing. (The MCP annotation tools operate on the live project and stay
app-only; headless, pass `annotations` to `save_project` when building, or use this CLI.)

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
