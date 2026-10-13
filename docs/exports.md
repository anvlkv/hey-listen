# Analysis exports (chart image + data)

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
| `series` (incl. `loudnessMomentary`) | `time_s,value` |
| `pitch` | `time_s,f0_hz` (blank cell for an unvoiced frame) |
| `spectrum` | `freq_hz,mean_db,min_db,max_db` |
| `spectrogram` / `matrix` | wide: first column `time_s`, then one column per bin, header row = bin centre frequencies (`440.0` … or band index for index-axis matrices such as MFCC/chroma) |
| `readouts` (`levels` / `lufs` / `lra`) | `key,value` |
| `rhythm` (`tempo` / `onsets` / `downbeats`) | `time_s,onset_strength` for the envelope, then a blank line + an `events` block (`time_s,type`) |

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
  About): *Data → JSON*, *Data → CSV*, *Chart → PNG*, and *Copy CSV* / *Copy image*
  (the clipboard plugin is already wired).
- **Tab context menu** — `Workbench.getTabContextMenuItems` gains an **Export ▸** entry
  (alongside *Pop out to window*).
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

- **MCP** (`src/state/mcp.ts` + `mcp/tools.rs`):
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
| `src/lib/export.ts` | Provenance envelope + per-view CSV renderer (frontend). |
| `src/state/exportRegistry.ts` | Charts register `image(toolId)` providers (canvas capture). |
| `src/components/analyzer/AnalyzerTab.tsx` | The per-tab Export popover. |
| `src/components/Workbench.tsx` | The tab-context **Export ▸** entry. |
| `src/components/analyzer/{SpectrumTab,WaveformTab,SeriesView,RhythmView,MatrixView,SpectrogramTab}.tsx` | Register their chart/image provider. |
| `src-tauri/src/commands/export.rs` (planned) | `pick_save_path` / `write_text` / `write_bytes`. |
| `src-tauri/src/audio/analysis.rs` (or a new `export.rs`) | The Rust CSV renderer shared with the CLI. |
| `src-tauri/src/cli/batch.rs` | `--format` / `--out`. |
| `src-tauri/src/mcp/tools.rs`, `src/state/mcp.ts` | The `export_*` tools. |

## Testing

- **CSV renderer** — Rust unit tests over each result type (wide matrix header/rows,
  gaps for pitch, readouts, rhythm events); the frontend renderer is kept in step
  (shared fixtures) or delegated to the same rule set.
- **Envelope** — a JSON export round-trips: applying its `window`/`params`/`options` to
  the same source reproduces the result.
- **Chart capture** — provider returns a non-null blob for each view kind; a headless
  `export_chart` reports "requires the app".
- **E2E (wdio)** — export CSV + PNG for a tab, assert the files exist and the CSV parses
  with the expected column count.

See [`roadmap.md`](roadmap.md) → **M12** and [`decisions.md`](decisions.md) → **ADR-16**.
