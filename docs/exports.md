# Analysis exports (chart image + data)

> **Implemented (M12).** The provenance envelope and the wide-matrix CSV renderer live
> in `src-tauri/src/export/` and are shared by the app, the MCP server, and the batch
> CLI. The frontend (`src/lib/export.ts`) gathers the current source/window/settings,
> picks a path, writes the files, and captures the rendered chart canvas. Data exports
> **re-run** the tool at the current settings rather than shipping a result back over
> IPC, so the file always matches the live project.

Every analyzer computes a typed result (`AnyAnalysisResult`) over the analysis window.
Today it is only ever *shown*: there is no way to save the numbers or the picture. This
document adds two exports per analyzer — the **data** (JSON / CSV) and the **chart
image** (PNG) — built so the same surface is reachable from the UI, the MCP server, and
the batch CLI.

The JSON data shape already exists: the Rust core serialises every result (that is what
`run_analysis` and the batch CLI's `emit` return). Exports add a **provenance
envelope**, a **CSV renderer**, and **PNG capture** of the rendered chart.

## Goal

- **Data** — save a tab's result as **JSON** (full fidelity) or **CSV** (spreadsheet /
  `pandas` / `R`), for one tool or every open tool at once.
- **Image** — save a tab's chart as **PNG**, exactly as rendered (theme included), at a
  crisp resolution.
- Every export is **self-describing**, so a file opened months later can be reproduced
  from a template + a source (see [`templates.md`](templates.md)).
- The data exports are **usable headless** (MCP + batch CLI); the image export needs the
  rendered canvas and is therefore GUI-only.

## Provenance envelope (JSON)

The JSON export wraps the tool's result so the file stands alone:

```jsonc
{
  "kind": "hey-listen.analysis",
  "formatVersion": 1,
  "tool": "spectrum",
  "generatedAt": 1730000000000,          // Unix ms
  "source": {
    "name": "mix.wav",
    "kind": "file",                      // file | mic | system | process | mix | synth
    "sampleRate": 48000,
    "channels": 2,
    "duration": 12.5,
    "path": "/Users/…/mix.wav"           // provenance only; may be null
  },
  "window": { "startSecs": 2.0, "endSecs": 4.0 },
  "params": { /* the shared SharedParams the result ran with */ },
  "options": { /* the per-tool options the result ran with */ },
  "result": { /* the typed AnalysisResult payload, e.g. SpectrumResult */ }
}
```

`window` + `params` + `options` + `tool` are exactly the fields a **template** stores,
so an exported file and a template together fully describe a reproducible analysis.

## CSV (wide matrix)

CSV is **data only**, with the shape chosen by the analyzer's view
(`AnalyzerView.kind`). 2D results are written as a **wide matrix**: one row per time
frame, one column per frequency band.

| View kind | Shape |
| --- | --- |
| `series` (incl. `frameRms` / `loudnessMomentary`) | `time_s,value` |
| `pitch` | `time_s,f0_hz` (blank cell for an unvoiced frame) |
| `spectrum` | `freq_hz,mean_db,min_db,max_db` |
| `spectrogram` / `matrix` | wide: first column `time_s`, then one column per bin, header row = bin centre frequencies (`440.0` … or band index for index-axis matrices such as MFCC/chroma) |
| `waveform` | `time_s,min,max` (one row per envelope bucket) |
| `readouts` (`levels` / `lufs` / `lra`) | `key,value` |
| `rhythm` (`tempo` / `onsets` / `downbeats`) | `time_s,onset_strength` for the envelope, then a blank line + an `events` block (`time_s,type`) |
| `noteMetrics` | one row per **detected** note: span, gaps, levels, levels relative to the loudest note, the voice-quality proxies, and the note's `envelope_db` samples (`|`-joined; they share `envelopePositions`) |
| `modulation` | `rate_hz,am_db,fm_db` (an absent spectrum leaves its column blank) |

- **Wide, not long**, for the 2D tools (a spectrogram is `frames × bins`, written rows =
  frames). This matches what a spreadsheet/`pandas` user expects; very wide files are the
  user's choice of FFT/bin count, not a format quirk.
- Numbers are written in full precision (`f64` as-is); the header carries the unit in
  the column name, so no separate unit column is needed.
- Provenance is **not** embedded in the CSV (public CSV has no comment convention).
  Exporting CSV also writes an optional **sidecar** `<name>.meta.json` (the same envelope
  minus `result`) so the numbers stay reproducible. The UI offers "Include sidecar
  metadata" (default on).

## Chart image (PNG)

Capture the **rendered** chart rather than re-rendering it, so the image matches what the
user sees (theme, zoom, visible range):

- **uPlot charts** (`waveform`, `spectrum`, the generic `series` / `rhythm` views): the
  instance is already reachable (`state/analyzer`+`uplotZoom` → `zoom.instance()`); export
  `u.ctx.canvas`. Optionally composite axes/title and render at **2× DPR** for a crisper
  file.
- **Canvas charts** (`spectrogram`, the generic `matrix`): expose each view's canvas via a
  tiny **`state/exportRegistry.ts`** — a view registers `image(toolId): Blob | null`, and
  the tab's export action pulls from it. This avoids pulling in a DOM-screenshot
  dependency.
- PNG bytes cross IPC base64-encoded through the shared `write_bytes` command (a chart is
  a few hundred KB — well within a single IPC message).

Image export is **GUI-only** (a headless host has no rendered chart); its MCP tool
answers "requires the app".

## Where the actions live

- **Per tab** — an **Export** popover in `AnalyzerTab`'s toolbar (next to Params /
  About): *Data → JSON*, *Data → CSV*, *Chart → PNG*, and *Copy CSV* (the clipboard
  plugin is already wired). Copying the chart image is deferred: the clipboard plugin
  wants raw RGBA, while the canvas capture is a PNG blob, and PNG file export covers the
  use case.
- **Tab context menu** — `Workbench.getTabContextMenuItems` gains flat export entries
  (JSON / CSV / PNG, plus *Export all open analyses…*) alongside *Pop out to window*;
  dockview's context menu has no submenu support.
- **All open tools** — an *Export all open analyses…* action exports every open analyzer
  tab to a chosen folder (JSON + CSV per tab).
- Exports are **not** stored in the project; they are one-shot writes to a user path.

## Shared output plumbing

Both this doc and [`templates.md`](templates.md) need to write a file to a user-chosen
path. That is added once (Rust):

| Command | Purpose |
| --- | --- |
| `pick_save_path(kind, defaultName)` | Native save dialog filtered by export kind (`csv` / `json` / `png` / `heyltemplate`). Generalises `pick_project_save_path`. |
| `write_text(path, contents)` | UTF-8 write (JSON / CSV). |
| `write_bytes(path, base64)` | Binary write (PNG). |
| `reveal_in_folder(path)` | Optional: reveal the written file (macOS `open -R`, Windows Explorer, Linux file manager). |

These are the same style of command as `save_project` (a user-chosen absolute path),
so no filesystem capability beyond what project save already needs.

## CLI / MCP surface (usable from both)

The **data** exports are pure compute over a result, so headless covers them fully; the
**image** export needs the GUI.

- **MCP** (`src/state/mcp/` + `mcp/tools/`):
  - `export_analysis { tool, format: "json" | "csv", path?, includeSidecar? }` — returns
    the serialised text (and writes it when `path` is given). `format` defaults to `json`.
    Works headless.
  - `export_chart { tool, path? }` — PNG of the rendered chart; **GUI-only** (answers
    "requires the app" headless).
  - `export_all { dir, formats: ["json","csv"] }` — every open tool to a folder (GUI for
    the tab set; headless takes an explicit tool list).
- **Batch CLI** ([`cli.md`](cli.md)) — extend `analyze` / `synth`:
  - `--format json|csv` (default `json`, matching today's JSONL). `--csv` is shorthand.
  - `--out <FILE|DIR>` — write to a file (single result) or a directory (per file/tool),
    instead of stdout.
  - CSV uses the **same wide-matrix renderer** as the UI (shared in Rust so both paths
    are byte-identical — the compact/`--full` rule already has this constraint).
  - Image export is not offered in the CLI (no canvas).

## Files

| Path | Role |
| --- | --- |
| `src/lib/export.ts` | The interactive half: request rendering, pick a path, write text/bytes, capture the chart canvas. |
| `src/state/exportRegistry.ts` | Charts register `image(toolId)` providers (canvas capture). |
| `src/components/analyzer/AnalyzerTab.tsx` | The per-tab Export popover (`ExportMenu.tsx`). |
| `src/components/Workbench.tsx` | The tab-context export entries (JSON / CSV / PNG, and export all). |
| `src/components/analyzer/{SpectrumTab,WaveformTab,SeriesView,RhythmView,MatrixView,SpectrogramTab,ModulationView,NoteSegmentChart}.tsx` | Register their chart/image provider. |
| `src-tauri/src/commands/export.rs` | `export_analysis` / `export_all`, `pick_save_path` / `pick_directory`, `write_text` / `write_bytes`. |
| `src-tauri/src/export/` | The envelope + wide-matrix CSV renderer shared with the CLI and MCP. |
| `src-tauri/src/cli/batch/` | `--format` / `--out`. |
| `src-tauri/src/mcp/tools/`, `src/state/mcp/` | The `export_*` tools. |

## Testing

- **CSV renderer** — Rust unit tests over each result type (wide matrix header/rows,
  gaps for pitch, readouts, rhythm events, note rows). The renderer is Rust-only, so
  the UI, MCP, and CLI cannot drift.
- **Envelope** — a JSON export round-trips: applying its `window`/`params`/`options` to
  the same source reproduces the result.
- **Chart capture** — a provider returns a non-null blob for each chart view; a headless
  `export_chart` reports that it needs the rendered canvas.
- **E2E (wdio)** — export CSV + PNG for a tab, assert the files exist and the CSV parses
  with the expected column count.

See [`roadmap.md`](roadmap.md) → **M12** and [`decisions.md`](decisions.md) → **ADR-16**.
