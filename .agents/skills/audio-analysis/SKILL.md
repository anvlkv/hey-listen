---
name: audio-analysis
description: Drive Hey Listen's analysis engine programmatically — via the MCP server (live app + UI following, or headless) or the batch CLI. Covers discovering analyzers, running them (summary/compact/full result modes), segmenting events, comparing projects, and building/opening/saving project files. Load when a task needs to analyze audio, find events or loop points, compare projects, or write a .heyl project.
---

# Driving Hey Listen's analysis engine

One engine, two programmatic surfaces — the **MCP server** and the **batch CLI**. Both
return the same envelope: effective `window` / `params` / `options`, a canonical `summary`,
and a `result` shaped by the requested mode.

**This file is a router.** Read the file for the surface you're using:

| File | Covers |
| --- | --- |
| [`mcp.md`](mcp.md) | MCP server: bridge vs headless, tools, workflow, projects/tabs/compare/annotations, export. |
| [`cli.md`](cli.md) | Batch CLI: `analyze` / `compare` / `project` / `annotations` / `synth`. |
| [`analyzers.md`](analyzers.md) | Every analyzer: result family, options, usage hint. |

You should not need the Hey Listen source — the MCP tool list + `get_state` + this skill
are the surface.

## Pick an interface

| Need | Use |
| --- | --- |
| Drive the live window; tabs/UI follow | MCP **bridge** |
| Lay analyzers out as a grid (not just tabs) | MCP **bridge** — `open_tool { position }`, app-only |
| Analyze files, nothing open | MCP **headless** (auto-fallback) |
| Build a `.heyl` (source, setup, tabs, annotations) | MCP headless `save_project`, or CLI `project` |
| Compare two projects | MCP `compare_analysis`, or CLI `compare` |
| Bulk-analyze files (shell/CI) | **Batch CLI** |
| Read/edit annotations in a saved `.heyl` | CLI `annotations` |

## Workflow

Discover before guessing; read the summary before the arrays:

```text
list_analyzers                        # catalog: id / title / section / family / keywords
get_analyzer { id }                   # option ranges, family, decimatable, summary keys
get_state                             # source, window, params, project, server mode
run_analysis { tool, summaryOnly: true }   # one-line answer first
→ read summary.text; ask for result only if you need the series
```

- Set shared window/params once (`set_analysis_window` / `set_shared_params`), per-tool
  options with `set_tool_options`. Inline `run_analysis` overrides apply to that call only
  with `transient: true`; otherwise they are **written back**.
- `display: false` computes without opening/focusing a tab (default `true`).

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

5. **Analyzer ids are case-sensitive.** Use exact ids from `list_analyzers`
   (`framerms` → "unknown analyzer").

6. **A `0` can mean "not applicable".** `tempo` reports `onsets 0` and `onsets` reports
   `tempo 0` — fields a tool doesn't produce read as `0`, not "none".

7. **`set_shared_params` can't return a param to "unset"** (e.g. `channel` back to `null`).

8. **The analysis window is not `transient`.** `export_analysis`/`export_chart` run over the
   current window, and `set_analysis_window` is written back even when `run_analysis` is
   `transient`. Snapshot the window before exporting.
