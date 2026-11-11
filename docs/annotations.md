# Annotations (stored as `Annotation`)

An **annotation** (M14; stored as an `Annotation`) is a piece of **markdown** you attach
to a point in the audio — optionally a span — and to the **analyzer chart** you were
looking at when you wrote it. The annotation keeps the **values that chart showed**
at that moment, so the observation stays meaningful even after the window or the
params move on.

Annotations are the project's *commentary layer*: they sit beside the analysis rather
than in it (they are not an analyzer tool and produce no `AnalysisResult`), and they
are reachable from the UI, the MCP server, and the batch CLI.

## Terminology: annotation vs. note segment

Two different things are easy to conflate:

- **Annotation** (this doc, M14) — **you** write it: markdown anchored to a time and
  a chart, with a frozen values snapshot. The rail is **Annotations**; the chart
  action is **Add annotation here**.
- **Note segment** (M18) — the **engine** detects it: a run of audio above an
  amplitude gate, with a start, end, gaps, and a per-segment level. It is the
  `noteMetrics` analyzer's result, shown as a table of *detected notes*.

The word **note** now means only that musical segment. The stored type is
`Annotation`, the project file keeps its `ANNOTATIONS` section, and the MCP/CLI
surfaces are `*_annotation` / `annotations`.

## Goal

- Attach a **markdown** annotation to an **audio time** (a point, optionally a range)
  and to the **chart it was taken from**.
- Show every annotation on the **Timeline**, each one on **its own chart**, and the
  **selected** one on **every time-based chart** — so a remark about one moment
  is visible wherever that moment is drawn.
- Keep a **frozen snapshot** of the chart's values as the annotation's subtitle, which
  refreshes whenever the annotation is edited or dragged (there is no recompute button).
- Reach them from the UI, MCP, and the batch CLI.
- Persist them in the project file; sync them across a project's windows.

## Model

An annotation is a small serde payload (`Annotation`), stored in the project file's `ANNOTATIONS`
section and exported to TypeScript (`src/bindings/`). See
[`data-model.md`](data-model.md).

```jsonc
{
  "id": "3f9c…",                       // stable id (uuid v4)
  "createdMs": 1730000000000,          // Unix ms
  "updatedMs": 1730000000100,
  "timeSecs": 2.34,                    // the anchor instant (source seconds)
  "range": { "startSecs": 2.34, "endSecs": 3.10 },  // optional span; absent = a point
  "tool": "spectrum",                  // the analyzer it was taken from; absent = a Timeline annotation
  "title": "Third harmonic",           // optional plain-text title (unused by the UI; the heading is the body's first line)
  "body": "Peak at **880 Hz** — the 2nd harmonic of the 440 Hz tone…",  // markdown
  // Frozen snapshot of the chart's values (see below). Absent for Timeline annotations.
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
  optional, so an annotation can also mark a span (e.g. "from here to here"). Setting a
  range never *replaces* the anchor — the point stays the annotation's identity, and the UI
  keeps a range's `startSecs` equal to `timeSecs` (dragging either edge moves the
  matching end).
- **Every time in the app is source seconds** — the annotation's anchor, the Timeline, and
  each analyzer chart's x-axis (a result carries the `windowStart` it was computed at,
  see [`analysis-tools.md`](analysis-tools.md) → Chart rendering). So an annotation lines up
  with the audio it describes without any per-chart conversion.
- **`tool`** is a stable analyzer id (e.g. `spectrogram`, `pitchYin`) — the
  *same* id `run_analysis` / the Sidebar use. Present = the annotation hangs off that
  chart. Absent = a **Timeline annotation** (taken directly on the timeline, with no
  chart).
- **`body`** is the only rich field: **markdown**, stored raw. The annotation's **heading
  is the first line of the body** — there is no separate title field (`title` is
  kept in the model for forward-compatibility but the UI neither sets nor shows it).
- **`values`** is the annotation's **subtitle** — a frozen snapshot, described next.

## The values snapshot

The subtitle is what makes an annotation self-contained: it is the chart's readout *at
the annotation's time*, captured when the annotation was written.

- **Source of the numbers** — for a **time-axis** chart (waveform, a series
  over time, spectrogram, matrix, rhythm) the values are the **per-frame readout
  at the annotation's time** (the same numbers the chart's hover tooltip shows, at the
  frame nearest `timeSecs`). For a tool with **no time axis** (`spectrum` is
  frequency-only; the scalar readouts like `loudnessIntegrated`) they are the
  tool's **summary** for the annotation's window.
- **Frozen, not live** — the snapshot is stored with the annotation, so it survives
  window / params / source changes and is available headless (MCP / CLI /
  project file). It carries its `window` / `params` / `options` provenance, so it
  lines up with an export envelope ([`exports.md`](exports.md)) or a template
  ([`templates.md`](templates.md)).
- **Recompute** — there is **no Recompute button**. A row always shows the chart's
  **current** readout at the annotation's time; when it differs from the frozen snapshot,
  the snapshot is shown **struck through** beneath the current line. Editing the
  annotation (or the end of a placement drag) refreshes the snapshot, so the struck-through
  line clears. The MCP `update_annotation` still exposes `recomputeValues`.

## Markdown

`body` is raw markdown. Editing is plain text; rendering is sanitized.

- **Explicit save** — the row's `edit` action swaps its rendered body for a
  **textarea** (focused, caret at the end) with a **save** (`✓`, `data-testid`
  `annotation.done.*`) and a **discard** (`✕`) action. **Done / ⌘(Ctrl)+Enter** commits the
  draft; **Escape** discards it. Blur is *not* a save, so a stray click can never lose
  an edit. The annotation is shown **once**: while editing, the textarea replaces the body.
- **Sanitized** — the rendered HTML is sanitized (raw HTML / scripts / event
  handlers stripped), so a pasted annotation cannot inject markup. This adds a small
  markdown renderer + sanitizer dependency (see [`dependencies.md`](dependencies.md)).
- The annotation's **title** and **values subtitle** are never markdown — they render
  as plain text everywhere (sidebar, chart label, timeline hover).

## The Annotations panel

Annotations live in a **right-hand panel** — a new **fixed region**, the mirror of the
Sidebar (see [`ui-layout.md`](ui-layout.md)). The rail's heading reads
**Annotations**; the code and test ids say `annotation` too. It is **not** a
Workbench tab: the only tabs are Workbench tabs, and an annotation panel is chrome,
not content.

- **Collapsible**, **hidden by default**. A Toolbar icon button (`annotation-sticky`)
  toggles it; while the rail is closed and annotations exist, the button carries its
  **count** as a muted pill *inside* the button (a tally, not a notification badge).
  The panel's own header has a chevron to collapse it, an **Add annotation** button (a
  **point** annotation at the analysis window's start, using the focused analyzer as
  its chart) and the total count. **Ranges are not made here** — they are drawn where the
  audio is, in the annotation lane (below).
- **Resizable** with a draggable splitter, clamped like the left Sidebar
  (160–520 px). The Workbench shrinks beside it (the panel pushes, it does not
  overlay).
- Open/closed state and width are **view settings**, persisted app-level (like
  the font scale), **not** part of the project.
- The list is **sorted by `timeSecs`**, one row per annotation. A row is a **title bar**
  — a compact, visually separated bar with the heading (the body's first line) on the
  left and the row actions as **borderless icons** on the right (`analyze`, `open chart`
  when the annotation has an analyzer, `edit`, `popout`, `delete`) — over its tool + time
  subtitle, its **current** values line (with the frozen snapshot struck through when it
  differs, and kept visible while editing, since it is what the annotation is *about*), and its
  **full rendered body** (clamped to a height, expandable with a chevron). Selecting the
  heading or the chart action **selects** the annotation (ADR-19); **Analyze** is the one
action that moves the analysis window. Editing swaps the body for the editor (above);
  the row never shows an annotation twice.
- **Popout** — the `popout` action opens the annotation in its **own window** (a real Tauri
  window, exactly like an analyzer tab's *Pop out to window*), for a roomier markdown
  surface. Opening an annotation that already has a window **raises** it rather than opening a
  duplicate.
- **Closing the rail** (its chevron, the Toolbar toggle, or a persisted-closed start)
  **clears the selection**: the selected-annotation overlay disappears from every chart and
  the lane anchors — still there, so the annotations remain locatable — are drawn dull.

## Surfacing: Timeline and charts

Annotations are drawn where the audio is drawn — in a thin **lane** along the **bottom**
edge, on the Timeline and on every time chart, so they stay clear of the Timeline's
window move handle and of a chart's drag/zoom area. The lane is also where they are
**created and edited** (see [`lane.ts`](#files)): one pointer gesture serves every host.

- **The lane** — press an annotation's **handle** to drag it: a **point** annotation moves, a
  **range** annotation resizes from whichever edge you took (grabbing anywhere across a range
  takes its nearer edge). Press **empty lane space** and drag to select a span; releasing
  creates a **range** annotation over it (a bare click does nothing). Hovering a handle shows a
  hint (heading + tool + values line); clicking an annotation's handle **selects** it (it never
  reframes — ADR-19).
- **Timeline** — the lane runs along the bottom of the waveform, and holds the
  **Timeline annotations** (those with no chart). It also mirrors the **hovered chart's
  cursor** as a dashed rule, so the moment a chart is pointing at is visible against the
  whole recording.
- **An annotation's own chart** — the annotations whose `tool` matches the chart are drawn on
  it (full-strength anchors); the annotations from **other** charts are drawn **muted**, so
  every annotation is visible where the audio is. Dragging in a chart's lane creates a
  annotation owned by **that chart**.
- **The selected annotation** — exactly **one** annotation is selected at a time. The selected
  annotation is drawn on **every time-based chart** (the `time` sync group: waveform,
  series-over-time, spectrogram, matrix, rhythm), via the shared chart bus
  (`state/chartSync.ts` + an annotation plugin). It is **not** drawn on the
  frequency-axis `spectrum` (a time marker has no meaning on a frequency axis).
- **Marker** — a full-height vertical rule on each of the annotation's edges (a shaded span
  for a range) plus its handles in the lane, with a **label** (the values line, else the
  heading) in a chip just above it. Clicking a marker **selects** the annotation.

**Selection follows the click:** selecting an annotation **opens (or raises) the chart it
belongs to** but **never moves the analysis window** — an annotation is a remark about a moment, not a
request to reframe. Moving the window onto an annotation is the row's explicit **Analyze**
action (a range becomes the window; a point gets a window of the current width starting
at its time), so both *creating* and *selecting* an annotation leave the analysis alone. See
[Creating an annotation](#creating-a-annotation) and `decisions.md` → ADR-19.

**The selected annotation is a panel concept.** Closing the rail clears the selection, which
also clears every chart's full-height overlay and the Timeline's stem; the lane anchors stay
(they are the index of where the annotations are) but are drawn **dull**.

**Saving with annotations stores the whole source.** Curating annotations while listening to
a fragment leaves the analysis window on that fragment; a **project save** that carries
annotations resets the analysis window to the whole file (and moves the live window with it),
so the saved project is not framed on the span being tagged (`lib/saveWindow.ts`). A save with
no annotations keeps the window the user chose.

**Planned (M23) — full-height rules on the Timeline.** While a span is dragged in the
lane, when a range is selected, and when an annotation is hovered, the Timeline draws
**vertical rules at the annotation's edges** across the waveform (plus a live `start → end (Δ)`
chip while creating), not just the lane handles. Other annotations keep the faint span tint and
a short stem so the waveform stays readable. This makes the annotated area legible against
the audio instead of only in the bottom strip. See [`roadmap.md`](roadmap.md) → M23.

## Creating an annotation

Three entry points, one model:

- **Annotations panel → Add** — a **point** annotation at the analysis window's start, with
  `tool` = the focused analyzer tab if one is open. Values are captured from that chart.
- **Annotation lane → drag a span** (the Timeline's or any time chart's) — a **range** annotation
  over the dragged span, owned by that chart (`null` on the Timeline). Dragging a
  annotation's handle instead *moves* or *resizes* that annotation; a bare click in the lane does
  nothing.
- **Chart context menu → Add annotation here** — a **point** annotation at the
  **clicked time** on that chart, with `tool` = that chart's tool. (The Timeline's own right-click
  already sets the window — *reframing* — so the Timeline right-click is left alone.)

Creating captures the **values snapshot** at that moment (frozen), opens the
panel if it is collapsed, **opens the new annotation's editor**, and **selects** it — without
moving the analysis window. There is also an **annotation at the playhead** action in the
Timeline transport (below), which is how an annotation is pinned to the moment being
auditioned.

## Preview playback and the shared playhead

The Timeline's transport auditions the analysis window through the core (ADR-9). Three
transport facilities are shared with the annotations layer:

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
- **Annotation at the playhead.** The transport's `annotation-sticky` button drops a **point**
  annotation at the playhead (enabled only while previewing), taking the focused analyzer
  as its chart like the panel's Add — so an observation made *while listening* lands on
  the right moment.

The transport **keeps auditioning the analysis window**: a preview started from the play
button follows the window when it moves — the Timeline's top move handle, a chart's
*Reframe* menu, an annotation's *Analyze*, undo/redo, or MCP `set_window`. The core mixes, filters
and resamples a region when it loads it, so the reload is **debounced to the move's
settle** (~200 ms, matching the analysis auto-run) instead of being re-sent at pointer
rate; an explicit range (`previewRegion`, e.g. an MCP `preview` with `start`/`end`) stays
where it was.

## Persistence and cross-window

- **Project file** — annotations are project content, stored in a new **`ANNOTATIONS`
  section (`0x07`, postcard)** of the `.heyl` container. Readers that predate it
  skip the section (the container already skips unknown ids). `save_project`
  takes the frontend's annotations; `load_project` returns them. See
  [`project-file-format.md`](project-file-format.md).
- **Cross-window** — the frontend owns the annotations store (like `params` /
  `toolOptions`) and broadcasts it as shared **UI state** (`uiState` keys
  `annotations` and `selectedAnnotationId`), so a project's popouts and its annotation windows stay in
  lockstep (ADR-11). No new Rust command owns them; they ride the existing
  `save_project` / `load_project` / `get_ui_state` / `set_ui_state` surface, plus the
  window commands below.
- **An annotation's own window** — `open_annotation_window` creates a real Tauri window aliased to
  the calling window's project (like `open_popout_window`), so the annotation is one more
  *view* of the project, never a project of its own. The window asks `popout_annotation`
  which annotation to render and pulls the annotations from `uiState`; it closes with its parent.
- **Dirty + history** — an annotation edit marks the project **dirty** and is one
  **undo/redo** step (`state/history.ts` snapshot gains the annotations + selection).
  Annotations reset with the history on New / Open.

## MCP surface

The annotation tools are **app-only**: an annotation lives in a project, and a headless session has no
annotation store (so they answer "requires the app"). Headless, `save_project` still accepts a
`annotations` array when building a project, and the batch CLI's `annotations` command edits a saved
file. Handlers live in `src/state/mcp/`; the catalog in `src-tauri/src/mcp/tools/`.

| Tool | Purpose |
| --- | --- |
| `list_annotations` | Every annotation in the project (id, time, range, tool, title, body, values). |
| `get_annotation` | One annotation by `id`. |
| `create_annotation` | Create at `time` (source seconds), optional `range` / `tool` / `title` / `body`; captures `values` from the target chart when it is open. |
| `update_annotation` | Patch `title` / `body` / `time` / `range` / `tool` (and `recomputeValues` to refresh the snapshot). |
| `delete_annotation` | Remove an annotation. |
| `set_selected_annotation` | Select one annotation (`id`) or clear it (`null`); the selected annotation shows on every time chart. |

`get_state` also reports the annotations (a compact summary) and the selected annotation id (its
wire key is `selectedAnnotationId`), so an agent can see the annotations on the project it is
driving.

## CLI surface

The batch CLI is windowless; its annotation surface works on a **saved project file**. It lists
annotations, and since M25.D it also edits them (append / patch / remove), rewriting the file
**atomically**. See [`cli.md`](cli.md).

```text
hey-listen-cli annotations <FILE.heyl>

Options:
      --json                 List: emit each annotation as one JSON line (JSONL) instead of a table.
      --full                 List: include the full markdown body (default: a one-line excerpt).
      --get <ID>             Print one annotation (full body and frozen values).
      --add <FILE.json>      Append the annotations in a JSON array file.
      --update <ID> --set FIELD=VALUE
                             Patch title / body / timeSecs (time, at) / range
                             (`start,end` or none) / tool (id or none). Repeatable.
      --delete <ID>          Remove one annotation.
      --to <FILE.heyl>       Write a changed project to a copy instead of in place.
```

Listing decodes the container and prints the annotations sorted by time. Mutations rewrite
the whole container (source, setup, layout, annotations, saved comparisons) through a sibling
temp file renamed over the target, so a failure cannot truncate the project; the file is
not watched, so an open app must **reload** it. A missing / unreadable / non-project
file, an unknown id, or an invalid field is an error (exit `1`); a malformed argument or
conflicting flags is a usage error (exit `2`). `analyze` / `synth` do **not** gain annotation
flags — they run against files, not projects, so there is nowhere to store an annotation.

## Files

| Path | Role |
| --- | --- |
| `src/state/annotations/` | The `Annotation` type, the store, create/update/delete/selection, the values capture, and `window.ts` (open an annotation's own window). |
| `src/lib/annotation.ts` | Pure annotation helpers (clamp, label, excerpt, the window-frame lookup `annotationFrameAt`) — unit-tested. |
| `src/lib/markdown.ts` | Markdown → sanitized HTML (`marked` + `dompurify`). |
| `src/components/AnnotationsPanel.tsx` | The right rail: the header (add / collapse) and the list. |
| `src/components/annotations/AnnotationRow.tsx` | One row: the title bar, meta, values, and the body *or* the editor. |
| `src/components/annotations/AnnotationEditors.tsx` | The inline editor (textarea, explicit save/discard). |
| `src/components/annotations/AnnotationWindow.tsx` | The content of an annotation's **own window** (a large, edit-only editor). |
| `src/components/annotations/lane.ts` | The annotation **lane**: its geometry, the handle hit-test, the drag / selection state machine every host shares, and its drawing. |
| `src/components/annotations/strip.ts` | The lane's height, shared by the Timeline and the charts. |
| `src/components/analyzer/annotationPlugins.ts` | The chart lane plugin: its own annotations, muted others, the selected rule + label, and the lane gesture. |
| `src/components/analyzer/ReframeMenu.tsx` | The chart right-click menu — carries **Add annotation here**. |
| `src/components/timeline/` | The Timeline canvas: the lane's painting (`draw.ts`) and pointer handling (`interaction.ts`). |
| `src/components/Toolbar.tsx` | The `annotation-sticky` toggle + its count chip. |
| `src-tauri/src/project/sections.rs` | The `Annotation` / `AnnotationValues` types (`#[derive(ts_rs::TS)]`) + the `ANNOTATIONS` section id. |
| `src-tauri/src/project/{write,read}.rs` | Write / read the `ANNOTATIONS` section. |
| `src/state/project/`, `src/state/history.ts` | Include annotations in save/load, undo/redo, and the dirty signature. |
| `src/state/uiState.ts`, `uiSync.ts`, `settings.ts` | Broadcast annotations + selection across a project's windows; the rail's view settings (open + width), persisted app-level. |
| `src-tauri/src/commands/window.rs` | `open_annotation_window` / `popout_annotation` — the annotation window. |
| `src-tauri/src/state/window/mod.rs` | The window registry (popout aliases, tool and annotation). |
| `src-tauri/cli/src/batch/` | The `annotations` subcommand (list / get / add / update / delete over a `.heyl`, M25.D). |
| `src/state/mcp/`, `src-tauri/src/mcp/tools/` | The `*_annotation` tools. |

## Testing

- **Round-trip** — an annotation (point and range, with and without `values`) survives
  `save_project` → `load_project` (Rust unit tests over the `ANNOTATIONS` section;
  frontend tests over the store).
- **Values snapshot** — capture produces the per-frame readout at the annotation's time
  for a time chart and the summary for a no-time-axis tool; a row shows the current
  readout and strikes through the frozen snapshot when they differ; editing the annotation
  (or a drag release) refreshes the snapshot.
- **Anchoring + drag** — `time` / `range` clamp to the source; dragging an annotation's
  handle moves a point annotation or resizes a range (either edge, never collapsing it below a
  hairline) and refreshes the snapshot on release; dragging a **lane span** creates a
  range — and no creation path moves the analysis window; an annotation with an unknown `tool`
  is kept but draws no chart marker (and its link is inert).
- **Source-second alignment** — an annotation at `t` is drawn at `t` on a chart whose window
  does **not** start at 0 (`windowStart` shifts the frame grid, not the annotation), and its
  values line reads the frame containing `t` (`annotationFrameAt`).
- **Surfacing** — the selected annotation is drawn on every time chart and **not** on
  `spectrum`; a chart draws its own annotations (and other charts' muted); the anchors sit in
  the bottom strip on both the Timeline and the charts.
- **Editor** — the body is swapped for the textarea while editing (never both); Done /
  ⌘↵ commits and Escape discards; a blur does not save.
- **Annotation window** — `open_annotation_window` shows a real window that renders just that annotation,
  pulling its data from the shared `uiState` and closing with its parent; opening the
  same annotation twice raises the existing window.
- **CLI** — `annotations <file.heyl>` prints the annotations (table / `--json`); a file with
  no `ANNOTATIONS` section prints nothing; a bad file exits `1`.
- **E2E (wdio)** — open a source, add an annotation from a chart, assert the Timeline
  anchor + the rail row + the frozen values, move the window and confirm the annotation's
  anchor and values still read the same source second, and reopen the project to
  confirm the annotations persist.

See [`roadmap.md`](roadmap.md) → **M14** and [`decisions.md`](decisions.md) →
**ADR-18**.
