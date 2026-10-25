# UI layout

## The one rule

**Timeline, Sidebar, Workbench, Source, and Annotations are fixed regions — not tabs.** The
only tabs in the app are **Workbench tabs**: the **graph editors** (filter /
synth) and, from M4, the **analyzer tabs**.

```
┌──────────┬───────────────────────────┬────────┐
│          │  Workbench                │ Notes  │
│  Sidebar │  (dockview — Workbench    │ (right │
│  (tool   │   tabs: graph editors +   │ rail;  │
│  picker) │   analyzers)              │ collap-│
│          │                           │ sible) │
├──────────┼───────────────────────────┤        │  ← draggable splitters
│ Source   │  Timeline (waveform +     │        │
│ (file/   │  window range)            │        │
│ mic/…)   │                           │        │
└──────────┴───────────────────────────┴────────┘
```

(The native window title bar sits above the Toolbar; it is not shown here. The **Notes**
rail runs the full height of the main area and **pushes** the Workbench — it does not
overlay it; it is hidden by default.)

## Windows

**One window = one project = one source** (ADR-3). The app can run **N independent
project windows**; **File → New Window** (or `→ New Window` on the app menu) opens a
fresh, empty one. Each window is a separate webview with its own core state
(`state::WindowRegistry`, keyed by window label) — so windows never share audio, and
the File/Edit menu actions act on the **focused** window.

A third kind of window, the **popout** (a Workbench tab moved to its own window), is
*not* an independent project: it is a real Tauri window whose label is aliased to the
originating window's project state, so it is one project seen through two windows
(ADR-11). See [Workbench tabs](#workbench-tabs).

## Row sizing

The Source + Timeline row has a **fixed, user-adjustable height** — both are the
same height by construction. The splitter above the row is dragged with the
pointer; the height is clamped so the Workbench keeps a usable minimum. The
default is compact (the Source panel's controls are sized to fit it without
scrolling); shrinking the row below the panel's content makes the panel scroll.

The row's two panels **swap in place** by context (they are not reordered):

- **No source yet** — the Source panel takes the *whole* row as a compact, **fixed-height
  horizontal strip** ("Add audio": the heading + hint on the left, the picker and its
  controls on the right, laid out inline and wrapping) and the Timeline is hidden
  (there is nothing to draw). The strip's controls are the *same* as the Source
  panel's — including gain, meter, and the start/stop timers.
- **Recording** — the Source controls sit beside the growing Timeline, so the meter
  and record controls are reachable.
- **A source exists and it is not recording** — the Timeline takes the whole row;
  the Source panel is hidden, since it is no longer needed. The Timeline's
  **Replace** button (an icon, with a tooltip) reveals it again (it stays until
  dismissed), so the source can still be changed.

The row (and the Sidebar) keeps its own **draggable splitter**: the height is clamped
so the Workbench keeps a usable minimum, and the sidebar width is clamped to
160–520 px. The splitter above the row is only shown **when the Timeline is** (the
compact "Add audio" state has a fixed height).

## Desktop-app conventions

- The **native window title bar** carries the app name ("Hey Listen").
- A **native application menu** carries the document actions: **File** (New /
  Open… / Open Recent → up to 10 files + Clear Menu / Save / Save As… —
  `CmdOrCtrl+N` / `O` / `S` / `Shift+S` — plus **Templates ▸** (Apply / Save as
  Template… / Import / Export, M13 planned) and Close on macOS / Quit elsewhere),
  **View** (fullscreen), **Window** (minimize/maximize), and **Help** / About. On
  macOS the standard application menu (About / Services / Hide / Quit) precedes
  them. **About** is a custom item that opens the in-app **About** dialog (identity +
  attributions) rather than the native panel. File actions are emitted to the
  frontend via `app:menu`; the rest are native. An **Edit** menu carries **Undo** (`CmdOrCtrl+Z`) and **Redo**
  (`Shift+CmdOrCtrl+Z`) for the app-level edit history (see
  [`roadmap.md`](roadmap.md) → Backlog). See `src-tauri/src/menu.rs`. The
  **Toolbar shows the current project name** — the file actions live in the File
  menu, not in the Toolbar.
- The in-app **Toolbar** has no title/branding — it holds app-level actions and
  status only. No hero/header like a website. It carries the app-level audio
  controls (the preview **output gain + device**, and the preview **output meter**
  which reads the core's playback level via
  `output_level`, all driving the core, ADR-9), the **Analysis params** popover (the
  shared, synced analysis params — see [`analysis-tools.md`](analysis-tools.md)), an
  **Appearance** popover (UI scale + theme — see [Theming](#theming)), a **Templates**
  popover (save / apply / import / export analysis templates — see
  [`templates.md`](templates.md)), a **Notes** toggle (an icon button that shows /
  hides the right rail — see [Annotations panel](#annotations-panel)), an **MCP** popover (the Model
  Context Protocol server's on/off, port, live status, and a copyable `mcpServers`
  snippet — see [`mcp.md`](mcp.md)), and an **About** button (app identity +
  attributions — see [Icons, tooltips, and About](#icons-tooltips-and-about)). The
  popover triggers are icons (`sliders` / `circle-half-stroke` / `plug` /
  `circle-question`) with tooltips; the **Notes** toggle is the `note-sticky` icon.
  The temporary **`Rust backend:`** status (the M0 IPC-ping scaffold) is gone.
- **Numeric inputs** support **drag-to-adjust** — drag up to increase, down to
  decrease (Shift for fine control) — in addition to typing. There is no slider; an
  `ns-resize` cursor is the only affordance. This covers the Kobalte `NumberField`s
  (timers, frequency range, per-tool params), the graph nodes' inline params, and the
  synth length (`src/lib/dragNumber.ts`).
- A **failed preview reports why** in the Toolbar: the device-dependent region load
  (no output device, device busy, …) surfaces as a red `toolbar.preview.error` status
  and clears on the next successful attempt. The transport clock is frontend-side, so
  the failure never leaves a moving playhead or a "playing" button behind.
- A user-adjustable **font size / UI zoom** (0.8–1.4×) scales the whole interface;
  it lives in the toolbar **Appearance** popover (the former **View** popover) and is
  persisted.

## Scrolling

Lists (the Sidebar tool list, the graph palette) use a custom `ScrollArea`
(`src/components/ScrollArea.tsx`). macOS WKWebView shows an overlay scrollbar that
ignores `::-webkit-scrollbar` / `scrollbar-width`, so the viewport is
`overflow: hidden` and the content is **translated** by `scrollTop` ourselves —
wheel/trackpad and the draggable thumb drive the same signal, giving a consistent
bar on every platform with no native scrollbar.

## Theming

The app ships exchangeable themes (M11): a **mode** (`Auto` / `Dark` / `Light`) plus a
**dark-slot** and a **light-slot** theme, chosen in the toolbar **Appearance** popover
and persisted app-level. A theme overlays a built-in **base** (`data-theme` on the
root); its palette drives the UI (CSS custom properties), the charts (uPlot series/
axis colours, spectrogram background and colormap), and the dockview / `solid-flow`
themes. The registry **bundles** dark, light, **Retrowave Neon** (the shipped default,
in the dark slot), Nord and Solarized Dark / Light; an installed `.heyltheme` overlays
one of the bases (partial `ui` / `chart` / `colormap` / `flow`), and `auto` follows the
OS to pick a slot. Import / export / delete / reveal live in the same Appearance
popover. See [`theming.md`](theming.md).

## Icons, tooltips, and About

- **Icons** come from **Font Awesome 7 Free (Solid)** — one bundled OTF
  (`public/fonts/fontawesome/`) drives every icon. The curated set lives in
  `src/lib/icons.ts` (`ICON_GLYPHS`, plus `VIEW_ICONS` / `GRAPH_ICONS`), rendered by
  `src/components/Icon.tsx`; the code point is written to `data-icon` and the `.fa`
  rule in `src/icons.css` renders it, so the CSS needs no per-icon rules. Attribution
  is in the About dialog; the license ships with the font.
  - **Sidebar rows** use the tool's **chart-type** icon (`VIEW_ICONS`, keyed by the
    analyzer's `view.kind`: waveform / series / spectrum / rhythm / matrix /
    spectrogram / readouts), tucked into the **bottom-right corner** of the row. Two
    tools of the same chart type share an icon. Section titles and subtitles are plain
    text (no icons).
- **Compaction:** self-evident controls are **icon-only** (popover triggers, zoom,
  MCP copy, graph clear, import / export / delete / reveal, the timeline's replace and
  zoom, record / pause / stop, the theme-mode buttons, the sidebar rows); primary and
  transport actions keep a **short label** beside the icon. Icon-only controls always
  keep an `aria-label`.
- **Tooltip** (`src/components/Tooltip.tsx`) — a theme-styled hint over Kobalte's
  `Tooltip`, replacing the native `title` on controls. The trigger wrapper is a
  single-child **column flexbox**, so it has a real box (Floating UI needs one to
  anchor to — a `display: contents` wrapper puts every tooltip at the top-left) while
  staying layout-transparent: the wrapped control still fills/stretches exactly as it
  did unwrapped. (Static readouts and error/warning spans keep a native `title`.)
- **About** (`src/components/AboutDialog.tsx`) — a modal opened from the Toolbar's
  `circle-question` button and from native **Help → About** (on macOS, the app menu),
  which emits `about` on `app:menu`. It carries the app identity and the **required
  attributions** (Font Awesome first, then the runtime dependencies), and points to
  `ACKNOWLEDGEMENTS.md` (the individual contributors to those dependencies); license
  links open in the system browser via the `open_external_url` command.

## Fixed regions

| Region | Role | Notes |
| --- | --- | --- |
| **Timeline** (bottom-right) | waveform + analysis-window range slider + the note lane, with a horizontal scrollbar when zoomed in | grows while recording; zooms on short windows; drag start/end previews playback, or drag the whole window by its top handle; pick a channel or downmix to mono for multichannel sources; carries the **Filter switch** (the on/bypassed indicator and bypass control in one — it reads **off** while the filter graph is still the identity seed); **overlays the filtered signal** when a filter is active; carries the **note anchors** in a thin lane along the bottom, and mirrors the hovered chart's cursor |
| **Sidebar** (top-left) | tool picker | opens Workbench tabs — analyzers first (grouped by domain), then the graph editors; a search box filters the analyzer list |
| **Workbench** (top-right) | hosts the Workbench tabs via `dockview` | the only tabbed area |
| **Source** (bottom-left) | audio source picker (file / mic / system / process / mix / synth) | changing the source replaces the whole timeline |
| **Annotations** (right rail; code/test ids say `notes`) | the project's annotations — a list of markdown annotations anchored to a time + chart | collapsible, hidden by default; a fixed region, **not** a tab (M14) |

None of these are closable, draggable, or tabbed.

## Workbench tabs

- Managed by `dockview` (mounted **only** in the Workbench region).
- Two kinds: the **graph editors** (`filter`, `synth` — see ADR-10) and the
  **analyzer tabs** (M4+).
- **No duplicate tabs** — a tool/editor can be open at most once.
- Tabs are dragged to reorder / **split / join** groups. The drag runs on
  dockview's **pointer** strategy (`dndStrategy: "pointer"`): the system WebView
  does not drive HTML5 drag-and-drop reliably, which left edge drops inoperative.
- Any Workbench tab can be **popped out** into its own window (M7): right-click the
  tab → **Pop out to window**. On macOS a `window.open` popup crashes loading
  `tauri://…` (the custom URL-scheme handler is only wired for a full wry webview), so
  the popout is a **real Tauri window** created by `open_popout_window` — the frontend
  only renders (ADR-11). It shows just that tool (no tab strip), is a *view* of the
  same project, and its title is `<tool> — <project>`. Selecting that tool in the
  Sidebar **raises** the popout (`focus_popout`) rather than opening a duplicate tab,
  and a *new* tool always opens in the main window. There is **one window per tool per
  project**: popping it out again raises the window, and closing it forgets the tool, so
  selecting it again opens a **tab**. A project load (or New Project) reconciles the
  windows (`sync_popouts`): the tools its layout records get exactly one window each, and
  popouts it does not record close.
- A **note** pops out the same way (`open_note_window`, from the Annotations rail's row): a
  real window that renders just that note's editor, aliased to the same project and
  raised rather than duplicated. A popout of either kind is never a project window:
  the MCP server routes its tool calls to the owning project, and `list_projects`
  lists only real projects.
- **Analyzer popouts** are offered (graph editors stay in the Workbench: their state
  is frontend-only). A popout pulls the project's shared state
  (`timeline`/`params`/`toolOptions`/`views`/`project`) on load and pushes its own
  edits back, so the analysis window, chart zoom, and params stay in sync **across
  windows**; a project window closes its popouts when it closes, and popouts are
  re-created on project load.
- Each analyzer tab has a **params popover** and an **about popover**.
- Each analyzer tab has an **Export** popover — **data** (JSON / CSV), **chart** (PNG),
  and copy-to-clipboard — and the tab context menu carries **Export ▸** (M12, planned);
  an *Export all open analyses…* action writes every open tab to a folder. See
  [`exports.md`](exports.md).
- A **busy indicator** shows progress without blocking: the **first** computation
  (nothing to show yet) spins in the **centre** of the tab; a **recompute** (params
  or window change while a result is on screen) spins in the **bottom-right corner**
  so the stale result stays visible.
- Analyzer charts **currently zoom on scroll** and carry an on-chart **zoom control**
  (zoom in / out / fit with a range readout); the spectrogram also **pans by
  dragging** (wheel zooms time, Shift+wheel zooms frequency). **M23 planned:** a plain
  wheel/trackpad scroll pans (time; frequency on 2-D views), pinch / `⌘`/Ctrl+wheel zooms
  at the cursor, and a horizontal gesture never zooms. See
  [`roadmap.md`](roadmap.md) → M23.
- Axis labels stay **un-truncated** — sized margins and formatted ticks/units (the
  charts and the Timeline ruler).
- **Zoom and cursor are synced across analyzer tabs** (where relevant): every
  uPlot chart shares one `createPluginBus` (`state/chartSync.ts`), so the hovered
  cursor is mirrored onto the others and x-zoom is shared within a group (time
  charts follow each other; the spectrum group follows frequency). The canvas
  spectrogram / matrix views join the time group too. Zooming **cannot** go beyond
  the data's x extent (the range is clamped). Cross-tab **and cross-window** zoom is
  synced: a chart's view is pushed to the core as `view:time` / `view:freq` and
  applied in the project's other windows (ADR-11). Moving the analysis window clears
  the shared view after a short settle so every chart re-fits to the new extent; a
  chart zoomed **after** the move keeps its zoom (the pending clear is dropped) — a
  throttled timer can otherwise run late and silently undo a newer zoom on CI.

  > **Careful when consuming the bus.** It is a Solid store, and `setData` *merges* an
  > object into an existing key: it notifies the message's **fields**, not the key, so a
  > listener that tracked only `bus.data.playhead` (say) fires once and then never again.
  > Worse, an effect keeps only the dependencies **its last run** read — so a consumer that
  > returns early on one field (the `group` tag, say) *drops* the rest and stops firing when
  > they change. Both traps bit a chart (the transport playhead, the cross-window cursor
  > mirror), so every consumer of an object-valued key now reads whole messages through
  > `readBusMessage` (`state/chartSync.ts`), which reads every field in every run. See
  > `docs/roadmap.md` → M14 follow-up.

## Sidebar

The Sidebar's **width is draggable** (a splitter between it and the Workbench,
clamped to 160–520 px). It lists every available analyzer tool (see
[`analysis-tools.md`](analysis-tools.md)) and, below them, the two graph editors —
**analyzers come first**, grouped by domain (time / spectral / pitch / rhythm /
**loudness). A **sticky search box** at the top filters the analyzer list by
title, description, and keywords; the graph editors are always shown. Clicking an
entry opens its tab in the Workbench (no-op if already open; selects the existing
tab).

## Annotations panel

The **Annotations** region is a **right rail** — a fixed region (not a tab), the mirror of the
Sidebar and the home of the project's annotations (M14; see
[`notes.md`](notes.md)). It is **hidden by default** and toggled from the Toolbar
(`note-sticky`) or its own header chevron; its width is draggable (clamped like the
Sidebar, 160–520 px) and it **pushes** the Workbench rather than overlaying it. Open/
closed state and width are **view settings** persisted app-level (like the font scale),
not project state.

Each row is one note, **sorted by time**. A row is a compact, visually separated
**title bar** — its heading (the body's first line) with the row actions as borderless
icons (`open chart` when the note has an analyzer, `edit`, `popout`, `delete`) on the
right — over its tool + time subtitle, its **current** values line (the frozen snapshot
is shown struck through beneath when it differs), and its **full rendered body** (clamped
to a height, expandable with a chevron). Selecting the heading **focuses** the note — it
then appears on every time-based chart and its chart is opened/raised. Editing **swaps**
the body for a textarea with an explicit save/discard (a blur does not save). The
`popout` action opens the note in its **own window**, raised rather than duplicated. The
header has an **Add note** button (a **point** note at the analysis window's start, using
the focused analyzer as its chart), and the Toolbar button carries its **count** as a
muted pill inside the button while the rail is closed. **Ranges are made where the audio
is**: dragging a span in the note **lane** along the bottom of the Timeline or of any time
chart creates a range note there, and a range then shows a **handle on each edge** in that
lane so either end can be dragged (a point note has one handle, which moves it).

Notes are surfaced in three places: every note in the note **lane** along the bottom of
the Timeline (a range shows a handle on each edge, so either end is draggable, and dragging
a span in the lane marks a new one), a chart's **own** notes in that chart's lane (with the
notes from other charts drawn **muted**), and the **focused** note as a full-height rule
with a label on **all time-based charts** (never the frequency-axis `spectrum`). The
Timeline also mirrors the **hovered chart's cursor** as a dashed rule. See
[`notes.md`](notes.md) → Surfacing.

## Source picker

The **Source** region sits in the **bottom-left corner**, where the Sidebar
column meets the Timeline row, and is fixed there (not a tab). It chooses the
project's single audio source (see [`source-model.md`](source-model.md)) — file,
mic, system loopback, process loopback, or mix. Changing the source replaces the
whole timeline.

The region picks the source kind (file / mic / system / process / mix) and, for
live kinds, holds that kind's controls: device or process selection (comboboxes),
gain, a start-timer delay, a target duration, record/pause/stop, and an input
meter. The picking side is fixed (not a tab); recorded audio becomes the
timeline's source like any other. With **no source yet** the same controls render
as a compact horizontal strip across the whole row (see [Row sizing](#row-sizing));
while **recording**, the ones that cannot be changed mid-capture (the kind picker,
device/process selection, and the timers) are hidden.

Selecting a live kind opens a capture session right away so the **input meter is
live even while idle** (monitoring); Record reuses that session and starts
appending to the timeline. See [`source-model.md`](source-model.md).

The controls are built on `@kobalte/core` primitives — `Select` for the source
kind, `Combobox` for device / application selection, `Slider` for gain,
`NumberField` for the start/stop timers, and `Meter` for the input level — so
keyboard support, typeahead and ARIA wiring come from the toolkit (see ADR-8).
Styling is ours, via Kobalte's `data-*` state attributes. Buttons use Kobalte's
`Button` throughout; **tabs stay dockview's** (the Workbench tabs only).
