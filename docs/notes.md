# Notes

A **note** is an annotation on a project: a piece of **markdown** you attach to a
point in the audio — optionally a span — and to the **analyzer chart** you were
looking at when you wrote it. The note keeps the **values that chart showed** at
that moment, so the observation stays meaningful even after the window or the
params move on.

Notes are the project's *commentary layer*: they sit beside the analysis rather
than in it (they are not an analyzer tool and produce no `AnalysisResult`), and
they are reachable from the UI, the MCP server, and the batch CLI.

## Goal

- Attach a **markdown** note to an **audio time** (a point, optionally a range)
  and to the **chart it was taken from**.
- Show every note on the **Timeline**, each note on **its own chart**, and the
  **focused** note on **every time-based chart** — so a remark about one moment
  is visible wherever that moment is drawn.
- Keep a **frozen snapshot** of the chart's values as the note's subtitle, with a
  one-click **recompute** when the analysis has changed.
- Reach them from the UI, MCP, and the batch CLI.
- Persist them in the project file; sync them across a project's windows.

## Model

A note is a small serde payload (`Note`), stored in the project file's `NOTES`
section and exported to TypeScript (`src/bindings/`). See
[`data-model.md`](data-model.md).

```jsonc
{
  "id": "3f9c…",                       // stable id (uuid v4)
  "createdMs": 1730000000000,          // Unix ms
  "updatedMs": 1730000000100,
  "timeSecs": 2.34,                    // the anchor instant (source seconds)
  "range": { "startSecs": 2.34, "endSecs": 3.10 },  // optional span; absent = a point
  "tool": "spectrum",                  // the analyzer it was taken from; absent = a Timeline note
  "title": "Third harmonic",           // optional plain-text title (unused by the UI; the heading is the body's first line)
  "body": "Peak at **880 Hz** — the 2nd harmonic of the 440 Hz tone…",  // markdown
  // Frozen snapshot of the chart's values (see below). Absent for Timeline notes.
  "values": {
    "tool": "spectrum",
    "label": "Spectrum @ 2.34 s",
    "text": "peak 880.0 Hz, −12.4 dBFS",  // the compact values line (the subtitle)
    "window": { "startSecs": 0.0, "endSecs": 4.0 },
    "params": { /* the SharedParams the chart ran with */ },
    "options": { /* the per-tool options the chart ran with */ },
    "capturedMs": 1730000000000
  }
}
```

- **`timeSecs`** is the anchor. It is a **point** by default; **`range`** is
  optional, so a note can also mark a span (e.g. "from here to here"). Setting a
  range never replaces the anchor — the point stays the note's identity.
- **`tool`** is a stable analyzer id (e.g. `spectrogram`, `pitchYin`) — the
  *same* id `run_analysis` / the Sidebar use. Present = the note hangs off that
  chart. Absent = a **Timeline note** (taken directly on the timeline, with no
  chart).
- **`body`** is the only rich field: **markdown**, stored raw. The note's **heading
  is the first line of the body** — there is no separate title field (`title` is
  kept in the model for forward-compatibility but the UI neither sets nor shows it).
- **`values`** is the note's **subtitle** — a frozen snapshot, described next.

## The values snapshot

The subtitle is what makes a note self-contained: it is the chart's readout *at
the note's time*, captured when the note was written.

- **Source of the numbers** — for a **time-axis** chart (waveform, a series
  over time, spectrogram, matrix, rhythm) the values are the **per-frame readout
  at the note's time** (the same numbers the chart's hover tooltip shows, at the
  frame nearest `timeSecs`). For a tool with **no time axis** (`spectrum` is
  frequency-only; the scalar readouts like `loudnessIntegrated`) they are the
  tool's **summary** for the note's window.
- **Frozen, not live** — the snapshot is stored with the note, so it survives
  window / params / source changes and is available headless (MCP / CLI /
  project file). It carries its `window` / `params` / `options` provenance, so it
  lines up with an export envelope ([`exports.md`](exports.md)) or a template
  ([`templates.md`](templates.md)).
- **Recompute** — there is **no Recompute button**. A row always shows the chart's
  **current** readout at the note's time; when it differs from the frozen snapshot,
  the snapshot is shown **struck through** beneath the current line. Editing the
  note (or the end of a placement drag) refreshes the snapshot, so the struck-through
  line clears. The MCP `update_note` still exposes `recomputeValues`.

## Markdown

`body` is raw markdown. Editing is plain text; rendering is sanitized.

- **Edit / preview** — the note's editor is a textarea. **Preview renders on
  focus loss** (blurring the editor renders the markdown; clicking the rendered
  body re-enters edit). No live side-by-side, no toggle to hunt for.
- **Sanitized** — the rendered HTML is sanitized (raw HTML / scripts / event
  handlers stripped), so a pasted note cannot inject markup. This adds a small
  markdown renderer + sanitizer dependency (see [`dependencies.md`](dependencies.md)).
- The note's **title** and **values subtitle** are never markdown — they render
  as plain text everywhere (sidebar, chart label, timeline hover).

## The Notes panel

Notes live in a **right-hand panel** — a new **fixed region**, the mirror of the
Sidebar (see [`ui-layout.md`](ui-layout.md)). It is **not** a Workbench tab: the
only tabs are Workbench tabs, and a note panel is chrome, not content.

- **Collapsible**, **hidden by default**. A Toolbar icon button (`note-sticky`)
  toggles it, carrying a **count badge** while the rail is closed; the panel's own
  header has a chevron to collapse it, an **Add note** button (anchors at the current
  analysis window, using the focused analyzer as its chart, with a **range** toggle),
  and the total count.
- **Resizable** with a draggable splitter, clamped like the left Sidebar
  (160–520 px). The Workbench shrinks beside it (the panel pushes, it does not
  overlay).
- Open/closed state and width are **view settings**, persisted app-level (like
  the font scale), **not** part of the project.
- The list is **sorted by `timeSecs`**, one row per note. A row is a **title bar**
  — the heading (the body's first line) plus the row actions (`open chart` when the
  note has an analyzer, `edit`, `popout`, `delete`) — over its tool + time subtitle,
  its **current** values line (with the frozen snapshot struck through when it
  differs), and its **full rendered body** (clamped to a height, expandable with a
  chevron). Selecting the heading **focuses** the note (below).
- **Popout** — the `popout` action opens the note in a large, **edit-only** view (a
  modal over the app), for a roomier markdown surface.

## Surfacing: Timeline and charts

Notes are drawn where the audio is drawn.

- **Timeline** — every note is a **pin** at `timeSecs` (a **span** for a range
  note), rendered as a new overlay pass in the Timeline canvas (ADR-7). Hovering
  a pin shows a hint (heading + tool + values line); clicking it focuses the note;
  **dragging** it along the timeline moves the note's time (the snapshot refreshes
  on release).
- **A note's own chart** — the notes whose `tool` matches the chart are drawn on
  it (full-strength ticks); the notes from **other** charts are drawn **muted**, so
  every annotation is visible where the audio is. A chart can be dragged the same
  way by grabbing a note's tick in the top band.
- **The focused note** — exactly **one** note is focused at a time. The focused
  note is drawn on **every time-based chart** (the `time` sync group: waveform,
  series-over-time, spectrogram, matrix, rhythm), via the shared chart bus
  (`state/chartSync.ts` + a note plugin). It is **not** drawn on the
  frequency-axis `spectrum` (a time marker has no meaning on a frequency axis).
- **Marker** — a vertical rule at `timeSecs` (a shaded span for a range note)
  with a small label (the title, or the values line). Clicking a marker focuses
  the note.

**Focus follows the click:** focusing a note **opens (or raises) the chart it
belongs to** and **sets the analysis window / cursor to the note's time** — the
same behaviour the Sidebar uses when it raises a popped-out tool (`focus_popout`).

## Creating a note

Two entry points, one model:

- **Notes panel → Add note** — anchors at the current analysis window (the point
  is the window start; an *use the window as a range* toggle sets `range`), with
  `tool` = the focused analyzer tab if one is open. Values are captured from that
  chart.
- **Chart context menu → Add note here** — anchors at the **clicked time** on
  that chart, with `tool` = that chart's tool. (The Timeline's own right-click
  already sets the window — *reframing* — so the Timeline right-click is left
  alone; Timeline notes are added from the panel.)

Creating captures the **values snapshot** at that moment (frozen), opens the
panel if it is collapsed, **opens the new note's editor**, and focuses it.

## Persistence and cross-window

- **Project file** — notes are project content, stored in a new **`NOTES`
  section (`0x07`, postcard)** of the `.heyl` container. Readers that predate it
  skip the section (the container already skips unknown ids). `save_project`
  takes the frontend's notes; `load_project` returns them. See
  [`project-file-format.md`](project-file-format.md).
- **Cross-window** — the frontend owns the notes store (like `params` /
  `toolOptions`) and broadcasts it as shared **UI state** (`uiState` keys
  `notes` and `focusedNoteId`), so a project's popouts stay in lockstep
  (ADR-11). No new Rust command owns them; they ride the existing
  `save_project` / `load_project` / `get_ui_state` / `set_ui_state` surface.
- **Dirty + history** — a note edit marks the project **dirty** and is one
  **undo/redo** step (`state/history.ts` snapshot gains the notes + focus).
  Notes reset with the history on New / Open.

## MCP surface

The note tools are **app-only**: a note lives in a project, and the headless
server has none (so it answers "requires the app", like `save_project`). Handlers
live in `src/state/mcp.ts`; the catalog in `src-tauri/src/mcp/tools.rs`.

| Tool | Purpose |
| --- | --- |
| `list_notes` | Every note in the project (id, time, range, tool, title, body, values). |
| `get_note` | One note by `id`. |
| `create_note` | Create at `time` (source seconds), optional `range` / `tool` / `title` / `body`; captures `values` from the target chart when it is open. |
| `update_note` | Patch `title` / `body` / `time` / `range` / `tool` (and `recomputeValues` to refresh the snapshot). |
| `delete_note` | Remove a note. |
| `set_focused_note` | Focus one note (`id`) or clear it (`null`); the focused note shows on every time chart. |

`get_state` also reports the notes (a compact summary) and the focused note id,
so an agent can see the annotations on the project it is driving.

## CLI surface

The batch CLI is windowless and has no project, so the note surface there is a
**read-only** command over a saved project file — the "show me the notes in this
session" view, usable from a shell or CI. See [`cli.md`](cli.md).

```text
hey-listen notes <FILE.heyl>

Options:
      --json     Emit each note as one JSON line (JSONL) instead of a table.
      --full     Include the full markdown body (default: a one-line excerpt).
```

It decodes the container, reads the `NOTES` section, and prints the notes sorted
by time. It **never mutates** the project file (the CLI is deterministic and does
not drive the app). A missing / unreadable / non-project file is an error (exit
`1`); a malformed argument is a usage error (exit `2`). `analyze` / `synth` do
**not** gain note flags — they run against files, not projects, so there is
nowhere to store a note.

## Files

| Path | Role |
| --- | --- |
| `src/state/notes.ts` | The `Note` type, the store, create/update/delete/focus, and the values capture. |
| `src/lib/note.ts` | Pure note helpers (clamp, label, excerpt, snapshot compare) — unit-tested. |
| `src/lib/markdown.ts` | Markdown → sanitized HTML (`marked` + `dompurify`). |
| `src/components/NotesPanel.tsx` | The right rail: the list, the editor (markdown + preview-on-blur), Add / Recompute / Delete. |
| `src/components/analyzer/notePlugins.ts` | The chart marker plugin (focused note on every time chart; a chart's own notes). |
| `src/components/analyzer/ReframeMenu.tsx` | The chart right-click menu — carries **Add note here**. |
| `src/components/Timeline.tsx` | The note pin/span overlay + hit-testing (ADR-7 canvas). |
| `src/components/Toolbar.tsx` | The `note-sticky` toggle for the panel. |
| `src-tauri/src/project/sections.rs` | The `Note` / `NoteValues` types (`#[derive(ts_rs::TS)]`) + the `NOTES` section id. |
| `src-tauri/src/project/{write,read}.rs` | Write / read the `NOTES` section. |
| `src/state/project.ts`, `src/state/history.ts` | Include notes in save/load, undo/redo, and the dirty signature. |
| `src/state/uiState.ts`, `src/state/uiSync.ts` | Broadcast notes + focus across the project's windows. |
| `src/state/settings.ts` | The Notes rail's view settings (open + width), persisted app-level. |
| `src-tauri/src/cli/batch.rs` | The `notes` subcommand (read-only over a `.heyl`). |
| `src/state/mcp.ts`, `src-tauri/src/mcp/tools.rs` | The `*_note` tools. |

## Testing

- **Round-trip** — a note (point and range, with and without `values`) survives
  `save_project` → `load_project` (Rust unit tests over the `NOTES` section;
  frontend tests over the store).
- **Values snapshot** — capture produces the per-frame readout at the note's time
  for a time chart and the summary for a no-time-axis tool; a row shows the current
  readout and strikes through the frozen snapshot when they differ; editing the note
  (or a drag release) refreshes the snapshot.
- **Anchoring + drag** — `time` / `range` clamp to the source; dragging a note's pin
  (Timeline) or tick (a chart) moves it and refreshes the snapshot on release; a note
  with an unknown `tool` is kept but draws no chart marker (and its link is inert).
- **Surfacing** — the focused note is drawn on every time chart and **not** on
  `spectrum`; a chart draws only its own notes.
- **CLI** — `notes <file.heyl>` prints the notes (table / `--json`); a file with
  no `NOTES` section prints nothing; a bad file exits `1`.
- **E2E (wdio)** — open a source, add a note from a chart, assert the Timeline
  pin + the sidebar row + the frozen values, move the window to make the snapshot
  stale, recompute, and reopen the project to confirm the notes persist.

See [`roadmap.md`](roadmap.md) → **M14** and [`decisions.md`](decisions.md) →
**ADR-18**.
