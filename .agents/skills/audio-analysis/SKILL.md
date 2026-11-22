---
name: audio-analysis
description: Drive Hey Listen programmatically — via the MCP server (live app + UI following, or headless) or the batch CLI. Covers discovering and running analyzers (summary/compact/full result modes), segmenting events, comparing projects, building/opening/saving project files, and authoring filter + synth graphs (node catalog, GraphSpec/DOT, subsystems, snoop, sound design). Load when a task needs to analyze audio, find events or loop points, compare projects, write a .heyl project, synthesize a sound, or filter audio.
---

# Driving Hey Listen's analysis engine

One engine, two programmatic surfaces — the **MCP server** and the **batch CLI**. Analyzers
(and the CLI `analyze` / `compare` / `synth`) return the same envelope: effective
`window` / `params` / `options`, a canonical `summary`, and a `result` shaped by the
requested mode. The filter + synth graphs have their own `GraphSpec`/DOT form — see
[`graphs.md`](graphs.md).

**This file is a router.** Read the file for the surface you're using:

| File | Covers |
| --- | --- |
| [`mcp.md`](mcp.md) | MCP server: bridge vs headless, tools, workflow, projects/tabs/compare/annotations, export. |
| [`cli.md`](cli.md) | Batch CLI: `analyze` / `nodes` / `synth` / `compare` / `project` / `annotations`. |
| [`analyzers.md`](analyzers.md) | Every analyzer: result family, options, usage hint. |
| [`graphs.md`](graphs.md) | Filter + synth graphs: node catalog, GraphSpec/DOT, subsystems, snoop, sound design. |

You should not need the Hey Listen source — the MCP tool list + `get_state` + this skill
are the surface.

## MCP tools vs the CLI — read this first

Drive Hey Listen with **MCP tool calls** — the tools in your tool list (`run_analysis`,
`open_tool`, `set_analysis_window`, `get_state`, `set_shared_params`, …). Call them
directly.

The **batch CLI** (`hey-listen-cli …`) is a *separate shell binary*, run from a **terminal**
for headless batch/CI. It is **not** an MCP tool: don't try to "call" it, and don't paste CLI
command text into your reply instead of acting. You never need the CLI to drive an open
project — if a project is open in the app, use the MCP tools.

## Pick an interface

| Need | Use |
| --- | --- |
| Drive the live window; tabs/UI follow | MCP **bridge** |
| Lay analyzers out as a grid (not just tabs) | MCP **bridge** — `open_tool { position }`, app-only |
| Analyze files, nothing open | MCP **headless** (auto-fallback) |
| Build a `.heyl` (source, setup, tabs, annotations) | MCP headless `save_project`, or CLI `project` |
| Compare two projects | MCP `compare_analysis`, or CLI `compare` |
| Bulk-analyze files (shell/CI) | **Batch CLI** (run in a terminal) |
| Read/edit annotations in a saved `.heyl` | CLI `annotations` (run in a terminal) |

## Cheapest-first rule

Every first call is `summaryOnly: true`. Answer from `summary.text`/`items`, then escalate
only if you need more:

```
summary  →  compact (default; noteMetrics.bounds segments without arrays)  →  full,
            and then always includeData + maxPoints + axis: "compact"
```

## Workflow

1. `get_state` — once: source shape, window, params, server mode (`bridge`/`headless`).
2. `list_analyzers` — pick tools. `get_analyzer { id }` only for the tools you'll run
   (option ranges, `decimatable`, summary keys). Use exact ids.
3. Set shared window/params once (`set_analysis_window` / `set_shared_params`), per-tool
   options with `set_tool_options`. Inline `run_analysis` overrides apply to one call only
   with `transient: true`; otherwise they are **written back**.
4. `run_analysis { tool, summaryOnly: true }` — always first. `display: false` computes
   without opening a tab (default `true`).
5. Escalate only if the summary doesn't answer (see Result modes).
6. Mutating tools (`open_tool` / `close_tool` / `set_*` / `create_annotation`) are
   read-modify-write — call them **sequentially**, never in parallel.
7. Report the numbers you got, the window/annotation you set, and any tool friction —
   nothing else.

## Result modes

Every call carries `summary` (one-line `text` + labelled `items`, identical in every mode),
the effective `window`/`params`/`options`, and `result`:

| Mode | MCP | CLI | `result` |
| --- | --- | --- | --- |
| summary | `summaryOnly: true` | `--summary` | omitted |
| compact (default) | — | — | structural stats |
| full | `includeData: true` | `--full` | raw arrays |

- `summaryOnly` ⇎ `includeData` (`--summary` ⇎ `--full`).
- Compact is structural per family: matrices/spectrograms keep dims + peak location; series
  become stats (with `nulls` for gaps, `hop` to map index→time); events/notes keep counts +
  a 5-record preview. `noteMetrics` also returns **`bounds`** (every span) — segment without
  a full result.
- `maxPoints: N` thins a full result family-aware (never drops `noteMetrics`/`onsets`
  events); check `decimatable` first.
- `axis: "compact"` replaces a `times` array with `{ start, hop, length, end }`.

## Gotchas

1. **`frameRms` is the sub-millisecond envelope — and window-capped.** `frameMs`/`hopMs`
   go to 0.05 ms, but the result caps at **8192 frames** and widens the hop to fit. A long
   window coarsens (10 s → ~1.2 ms); a short window (≤ ~0.37 s) reaches the **2-sample hop**
   (45 µs). For sample-accurate loop seams, use a short window and read the reported
   `hopSize`/`frameSize`.

2. **Perception analyzers read ~0 until calibrated.** `loudness`, `specificLoudness`,
   `sharpness`, `roughness`, `fluctuationStrength`, `tonality`, `masking` take
   `calibrationDbSpl` (**0 = uncalibrated → ~0**). Set it (e.g. `100`) for absolute values;
   defaults are mixed across tools (check `get_state.toolOptions`). Summarize with
   level-gated medians, not min/max (they land on silent frames).

3. **`channel` (default 0) picks the analyzed channel; the louder channel varies per
   instant.** Check **both** channels — for seams (level) *and* for brightness claims (a
   "brightest" readout can be a panned-channel artifact).

4. **`hop` is a fraction of `fftSize`, not samples** (`0.25` = 75% overlap; `1` = none).

5. **A `0` can mean "not applicable".** `tempo` reports `onsets 0` and `onsets` reports
   `tempo 0` — fields a tool doesn't produce read as `0`, not "none".
