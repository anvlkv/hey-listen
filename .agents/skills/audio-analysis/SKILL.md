---
name: audio-analysis
description: Drive Hey Listen's audio-analysis engine programmatically — via the built-in MCP server (agent access + live UI following) or the batch CLI (`hey-listen-cli analyze`, headless shell/CI). Covers picking the interface, the discover → run → read workflow, the tool inventory, result modes (summary / compact / full), event segmentation, comparisons, building/opening project files (sources, tabs, saved comparisons), and data/chart export. Use when a task needs to open a source, run analyzers, segment calls/syllables/notes, compare projects, save a project with its tabs/comparison, or read results from an MCP client or a shell.
---

# Driving Hey Listen's analysis engine (MCP + CLI)

One analysis engine (`audio::analysis::run_window`), two programmatic interfaces. Both
return the **same envelope** — effective `window` / `params` / `options`, a canonical
`summary`, and a `result` shaped by the requested mode.

**This skill is a router.** Read the file for the surface you're using:

| File | What it covers |
| --- | --- |
| [`mcp.md`](mcp.md) | The MCP server: bridge vs headless, the tool inventory, workflow, projects / tabs / comparisons / annotations, data + chart export. |
| [`cli.md`](cli.md) | The batch CLI: `analyze` / `compare` / `project` / `annotations` / `synth`, options, output, examples. |
| [`analyzers.md`](analyzers.md) | Every analyzer: id, result family, options + defaults, and a usage hint. |

You should not need the Hey Listen sources: the MCP tool list + `get_state` + this skill
are the surface.

## Pick an interface

| Need | Use |
| --- | --- |
| Agent drives the live window; tabs/UI follow | MCP **bridge** |
| Agent analyzes files with nothing open | MCP **headless** (auto-fallback) |
| Build a `.heyl` (source, setup, filter, tabs, annotations) | MCP headless `save_project`, or CLI `project` |
| Compare two projects | MCP `compare_analysis`, or CLI `compare` |
| Shell / CI bulk-analyzes files | **Batch CLI** |
| Read/edit annotations in a saved `.heyl` | CLI `annotations` (or MCP `save_project`/live tools) |

## The reliable workflow

Discover before you guess, and read the summary before the arrays:

```text
list_analyzers                        # compact catalog: id / title / section / family / keywords
get_analyzer { id }                   # about copy, option ranges, family, decimatable, summary keys
get_state                             # source shape, window, shared params, project, server mode
run_analysis { tool, summaryOnly: true }   # one-line answer first
→ read summary.text; ask for result only if you need the series
```

- Set shared window/params once (`set_analysis_window` / `set_shared_params`), then
  per-tool options (`set_tool_options`). Pass overrides inline to `run_analysis` for a
  single call.
- `transient: true` on `run_analysis` = independent call; without it, `start`/`end`/
  `params`/`options` overrides are **written back** and later calls inherit them.
- `display: false` computes without opening/focusing a tab (default `true`).

## Results: summary / compact / full

Every `run_analysis` call and CLI `analyze` record carries:

- **`summary`** — `{ tool, label, text, items }`: a stable one-line `text` plus labelled,
  unit-bearing `items`, computed from the **full** result (identical in every mode). Read
  it first.
- **`window` / `params` / `options`** — the **effective** settings used (unset fields
  omitted, no null padding).
- **`result`** — by mode:

| Mode | MCP | CLI | `result` |
| --- | --- | --- | --- |
| summary | `summaryOnly: true` | `--summary` | omitted |
| compact (default) | — | — | structural stats |
| full | `includeData: true` | `--full` | raw arrays |

- `summaryOnly` ⇎ `includeData` (`--summary` ⇎ `--full`) are mutually exclusive.
- Compact is **structural per family**: matrices/spectrograms keep dimensions + peak
  location (`peakTime`/`peakHz`/`peakDb`); numeric series become stats (with `nulls` for
  gaps and `hop` so an index maps to a time); event/note arrays keep counts + a 5-record
  preview. `noteMetrics` also carries **`bounds`** — every span — so segmenting never
  needs a full result.
- `maxPoints: N` thins a full result to ≤ N points, **family-aware** (time axes move
  together, matrices thin by whole frames). It never removes events from
  `noteMetrics`/`onsets`. Check `decimatable` from `get_analyzer` before relying on it.
- `axis: "compact"` replaces a `times` array with `{ start, hop, length, end }` (an
  overlap-add edge frame as `firstHop`/`lastHop`).

## Gotchas that have bitten agents

These are the option/behaviour facts that are easy to get wrong. Per-tool detail lives in
[`analyzers.md`](analyzers.md); the cross-cutting ones are here.

1. **`frameRms` is the only sub-millisecond envelope — and it's window-capped.**
   `frameMs` (0.1–1000) and `hopMs` (0.05–1000) are the knobs, but the engine caps the
   result at **8192 frames** and *widens the hop* to fit. So on a long window the hop
   coarsens (10 s → ~1.2 ms); to reach the floor of a **2-sample hop** (45 µs) you must
   use a short window (≤ ~0.37 s). For sample-accurate work (loop seams, click
   avoidance), set a short window and the engine reports the effective `hopSize`.

2. **Exports reflect the current analysis window.** `export_analysis` / `export_chart`
   capture the tool over the project's **current window** — call `set_analysis_window`
   first when you want a specific range (this is the reliable path; don't assume an
   ad-hoc range is what got exported).

3. **Perception analyzers read ~0 until calibrated.** `loudness` (sone/phon),
   `specificLoudness`, `sharpness` (acum), `roughness` (asper), `fluctuationStrength`
   (vacil), `tonality` and `masking` take `calibrationDbSpl` — **0 = uncalibrated**
   (relative, effectively ~0). Set it to the dB SPL of a full-scale sine (e.g. `100`)
   to read absolute values. They are custom approximations, not validated standards.
   Their min/max summaries land on silent frames — gate by level and use medians.

4. **`channel` (shared param) selects the analyzed channel; default 0.** The tools run
   on one channel. For stereo work (e.g. a loop seam) the **louder of the two channels**
   is what determines audibility — check both before committing.

5. **`hop` (shared param) is a fraction of `fftSize`, not a sample count.** `0.25` =
   75% overlap; `1` = no overlap.

6. **`transient: true`** — without it, `run_analysis` overrides are written back to the
   project and later calls inherit them.
