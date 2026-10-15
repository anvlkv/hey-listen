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
- Keep a **frozen snapshot** of the chart's values as the note's subtitle, which
  refreshes whenever the note is edited or dragged (there is no recompute button).
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
  range never *replaces* the anchor — the point stays the note's identity, and the UI
  keeps a range's `startSecs` equal to `timeSecs` (dragging either edge moves the
  matching end).
- **Every time in the app is source seconds** — the note's anchor, the Timeline, and
  each analyzer chart's x-axis (a result carries the `windowStart` it was computed at,
  see [`analysis-tools.md`](analysis-tools.md) → Chart rendering). So a note lines up
  with the audio it describes without any per-chart conversion.
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

- **Explicit save** — the row's `edit` action swaps its rendered body for a
  **textarea** (focused, caret at the end) with a **save** (`✓`, `data-testid`
  `note.done.*`) and a **discard** (`✕`) action. **Done / ⌘(Ctrl)+Enter** commits the
  draft; **Escape** discards it. Blur is *not* a save, so a stray click can never lose
  an edit. The note is shown **once**: while editing, the textarea replaces the body.
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
  toggles it; while the rail is closed and notes exist, the button carries its
  **count** as a muted pill *inside* the button (a tally, not a notification badge).
  The panel's own header has a chevron to collapse it, an **Add note** button (a
  **point** note at the analysis window's start, using the focused analyzer as its
  chart) and the total count. **Ranges are not made here** — they are drawn where the
  audio is, in the note lane (below).
- **Resizable** with a draggable splitter, clamped like the left Sidebar
  (160–520 px). The Workbench shrinks beside it (the panel pushes, it does not
  overlay).
- Open/closed state and width are **view settings**, persisted app-level (like
  the font scale), **not** part of the project.
- The list is **sorted by `timeSecs`**, one row per note. A row is a **title bar**
  — a compact, visually separated bar with the heading (the body's first line) on the
  left and the row actions as **borderless icons** on the right (`analyze`, `open chart`
  when the note has an analyzer, `edit`, `popout`, `delete`) — over its tool + time
  subtitle, its **current** values line (with the frozen snapshot struck through when it
  differs, and kept visible while editing, since it is what the note is *about*), and its
  **full rendered body** (clamped to a height, expandable with a chevron). Selecting the
  heading or the chart action **selects** the note (ADR-19); **Analyze** is the one
action that moves the analysis window. Editing swaps the body for the editor (above);
  the row never shows a note twice.
- **Popout** — the `popout` action opens the note in its **own window** (a real Tauri
  window, exactly like an analyzer tab's *Pop out to window*), for a roomier markdown
  surface. Opening a note that already has a window **raises** it rather than opening a
  duplicate.
- **Closing the rail** (its chevron, the Toolbar toggle, or a persisted-closed start)
  **unfocuses**: the focused-note overlay disappears from every chart and the lane
  anchors — still there, so the notes remain locatable — are drawn dull.

## Surfacing: Timeline and charts

Notes are drawn where the audio is drawn — in a thin **lane** along the **bottom**
edge, on the Timeline and on every time chart, so they stay clear of the Timeline's
window move handle and of a chart's drag/zoom area. The lane is also where they are
**created and edited** (see [`lane.ts`](#files)): one pointer gesture serves every host.

- **The lane** — press a note's **handle** to drag it: a **point** note moves, a
  **range** note resizes from whichever edge you took (grabbing anywhere across a range
  takes its nearer edge). Press **empty lane space** and drag to select a span; releasing
  creates a **range** note over it (a bare click does nothing). Hovering a handle shows a
  hint (heading + tool + values line); clicking a note's handle **selects** it (it never
  reframes — ADR-19).
- **Timeline** — the lane runs along the bottom of the waveform, and holds the
  **Timeline notes** (those with no chart). It also mirrors the **hovered chart's
  cursor** as a dashed rule, so the moment a chart is pointing at is visible against the
  whole recording.
- **A note's own chart** — the notes whose `tool` matches the chart are drawn on
  it (full-strength anchors); the notes from **other** charts are drawn **muted**, so
  every annotation is visible where the audio is. Dragging in a chart's lane creates a
  note owned by **that chart**.
- **The focused note** — exactly **one** note is focused at a time. The focused
  note is drawn on **every time-based chart** (the `time` sync group: waveform,
  series-over-time, spectrogram, matrix, rhythm), via the shared chart bus
  (`state/chartSync.ts` + a note plugin). It is **not** drawn on the
  frequency-axis `spectrum` (a time marker has no meaning on a frequency axis).
- **Marker** — a full-height vertical rule on each of the note's edges (a shaded span
  for a range) plus its handles in the lane, with a **label** (the values line, else the
  heading) in a chip just above it. Clicking a marker **selects** the note.

**Focus follows the click:** selecting a note **opens (or raises) the chart it belongs
to** but **never moves the analysis window** — a note is a remark about a moment, not a
request to reframe. Moving the window onto a note is the row's explicit **Analyze**
action (a range becomes the window; a point gets a window of the current width starting
at its time), so both *creating* and *selecting* a note leave the analysis alone. See
[Creating a note](#creating-a-note) and `decisions.md` → ADR-19.

**The focused note is a panel concept.** Closing the rail drops the focus, which also
clears every chart's full-height overlay and the Timeline's stem; the lane anchors stay
(they are the index of where the notes are) but are drawn **dull**.

## Creating a note

Three entry points, one model:

- **Notes panel → Add note** — a **point** note at the analysis window's start, with
  `tool` = the focused analyzer tab if one is open. Values are captured from that chart.
- **Note lane → drag a span** (the Timeline's or any time chart's) — a **range** note
  over the dragged span, owned by that chart (`null` on the Timeline). Dragging a
  note's handle instead *moves* or *resizes* that note; a bare click in the lane does
  nothing.
- **Chart context menu → Add note here** — a **point** note at the **clicked time**
  on that chart, with `tool` = that chart's tool. (The Timeline's own right-click
  already sets the window — *reframing* — so the Timeline right-click is left alone.)

Creating captures the **values snapshot** at that moment (frozen), opens the
panel if it is collapsed, **opens the new note's editor**, and **selects** it — without
moving the analysis window. There is also a **note at the playhead** action in the
Timeline transport (below), which is how a note is pinned to the moment being auditioned.

## Preview playback and the shared playhead

The Timeline's transport auditions the analysis window through the core (ADR-9). Three
transport facilities are shared with the notes layer:

- **Speed (varispeed).** A **log slider** beside the play button (`lib/previewSpeed.ts`,
  0.25×–4×, **1× exactly at the centre** — a linear track would crush every slow rate into
  its first percent). The core resamples the region (`preview_region`'s `speed`), so a rate
  **shifts pitch** like a tape machine rather than time-stretching, and it is a *preview*
  control only: analysis always reads the source at 1×. The frontend tracks the rate so the
  locally computed playhead stays in source seconds.
- **The playhead on every time chart.** The position rides the shared chart bus
  (`playhead`), so a chart draws the transport's own solid rule (the uPlot charts via
  `syncPlugins.playheadRule`, the canvas heatmaps via `chartCanvas.drawPlayhead`) — what is
  being auditioned is visible where the data is, not only on the Timeline.
- **Note at the playhead.** The transport's `note-sticky` button drops a **point** note at
  the playhead (enabled only while previewing), taking the focused analyzer as its chart
  like the panel's Add — so an observation made *while listening* lands on the right moment.

## Persistence and cross-window

- **Project file** — notes are project content, stored in a new **`NOTES`
  section (`0x07`, postcard)** of the `.heyl` container. Readers that predate it
  skip the section (the container already skips unknown ids). `save_project`
  takes the frontend's notes; `load_project` returns them. See
  [`project-file-format.md`](project-file-format.md).
- **Cross-window** — the frontend owns the notes store (like `params` /
  `toolOptions`) and broadcasts it as shared **UI state** (`uiState` keys
  `notes` and `focusedNoteId`), so a project's popouts and its note windows stay in
  lockstep (ADR-11). No new Rust command owns them; they ride the existing
  `save_project` / `load_project` / `get_ui_state` / `set_ui_state` surface, plus the
  window commands below.
- **A note's own window** — `open_note_window` creates a real Tauri window aliased to
  the calling window's project (like `open_popout_window`), so the note is one more
  *view* of the project, never a project of its own. The window asks `popout_note`
  which note to render and pulls the notes from `uiState`; it closes with its parent.
- **Dirty + history** — a note edit marks the project **dirty** and is one
  **undo/redo** step (`state/history.ts` snapshot gains the notes + focus).
  Notes reset with the history on New / Open.

## MCP surface

The note tools are **app-only**: a note lives in a project, and the headless
server has none (so it answers "requires the app", like `save_project`). Handlers
live in `src/state/mcp/`; the catalog in `src-tauri/src/mcp/tools/`.

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
| `src/state/notes/` | The `Note` type, the store, create/update/delete/focus, the values capture, and `window.ts` (open a note's own window). |
| `src/lib/note.ts` | Pure note helpers (clamp, label, excerpt, the window-frame lookup `noteFrameAt`) — unit-tested. |
| `src/lib/markdown.ts` | Markdown → sanitized HTML (`marked` + `dompurify`). |
| `src/components/NotesPanel.tsx` | The right rail: the header (add / collapse) and the list. |
| `src/components/notes/NoteRow.tsx` | One row: the title bar, meta, values, and the body *or* the editor. |
| `src/components/notes/NoteEditors.tsx` | The inline editor (textarea, explicit save/discard). |
| `src/components/notes/NoteWindow.tsx` | The content of a note's **own window** (a large, edit-only editor). |
| `src/components/notes/lane.ts` | The note **lane**: its geometry, the handle hit-test, the drag / selection state machine every host shares, and its drawing. |
| `src/components/notes/strip.ts` | The lane's height, shared by the Timeline and the charts. |
| `src/components/analyzer/notePlugins.ts` | The chart lane plugin: its own notes, muted others, the focused rule + label, and the lane gesture. |
| `src/components/analyzer/ReframeMenu.tsx` | The chart right-click menu — carries **Add note here**. |
| `src/components/timeline/` | The Timeline canvas: the lane's painting (`draw.ts`) and pointer handling (`interaction.ts`). |
| `src/components/Toolbar.tsx` | The `note-sticky` toggle + its count chip. |
| `src-tauri/src/project/sections.rs` | The `Note` / `NoteValues` types (`#[derive(ts_rs::TS)]`) + the `NOTES` section id. |
| `src-tauri/src/project/{write,read}.rs` | Write / read the `NOTES` section. |
| `src/state/project/`, `src/state/history.ts` | Include notes in save/load, undo/redo, and the dirty signature. |
| `src/state/uiState.ts`, `uiSync.ts`, `settings.ts` | Broadcast notes + focus across a project's windows; the rail's view settings (open + width), persisted app-level. |
| `src-tauri/src/commands/window.rs` | `open_note_window` / `popout_note` — the note window. |
| `src-tauri/src/state/window.rs` | The window registry (popout aliases, tool and note). |
| `src-tauri/src/cli/batch/` | The `notes` subcommand (read-only over a `.heyl`). |
| `src/state/mcp/`, `src-tauri/src/mcp/tools/` | The `*_note` tools. |

## Testing

- **Round-trip** — a note (point and range, with and without `values`) survives
  `save_project` → `load_project` (Rust unit tests over the `NOTES` section;
  frontend tests over the store).
- **Values snapshot** — capture produces the per-frame readout at the note's time
  for a time chart and the summary for a no-time-axis tool; a row shows the current
  readout and strikes through the frozen snapshot when they differ; editing the note
  (or a drag release) refreshes the snapshot.
- **Anchoring + drag** — `time` / `range` clamp to the source; dragging a note's
  handle moves a point note or resizes a range (either edge, never collapsing it below a
  hairline) and refreshes the snapshot on release; dragging a **lane span** creates a
  range — and no creation path moves the analysis window; a note with an unknown `tool`
  is kept but draws no chart marker (and its link is inert).
- **Source-second alignment** — a note at `t` is drawn at `t` on a chart whose window
  does **not** start at 0 (`windowStart` shifts the frame grid, not the note), and its
  values line reads the frame containing `t` (`noteFrameAt`).
- **Surfacing** — the focused note is drawn on every time chart and **not** on
  `spectrum`; a chart draws its own notes (and other charts' muted); the anchors sit in
  the bottom strip on both the Timeline and the charts.
- **Editor** — the body is swapped for the textarea while editing (never both); Done /
  ⌘↵ commits and Escape discards; a blur does not save.
- **Note window** — `open_note_window` shows a real window that renders just that note,
  pulling its data from the shared `uiState` and closing with its parent; opening the
  same note twice raises the existing window.
- **CLI** — `notes <file.heyl>` prints the notes (table / `--json`); a file with
  no `NOTES` section prints nothing; a bad file exits `1`.
- **E2E (wdio)** — open a source, add a note from a chart, assert the Timeline
  anchor + the rail row + the frozen values, move the window and confirm the note's
  anchor and values still read the same source second, and reopen the project to
  confirm the notes persist.

See [`roadmap.md`](roadmap.md) → **M14** and [`decisions.md`](decisions.md) →
**ADR-18**.
