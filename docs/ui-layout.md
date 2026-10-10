# UI layout

## The one rule

**Timeline, Sidebar, Workbench, and Source are fixed regions — not tabs.** The
only tabs in the app are **Workbench tabs**: the **graph editors** (filter /
synth) and, from M4, the **analyzer tabs**.

```
┌──────────────┬───────────────────────────┐
│              │  Workbench                │
│   Sidebar    │  (dockview — Workbench    │
│   (tool      │   tabs: graph editors +   │
│   picker)    │   analyzers)              │
│   picker)    │                           │
├──────────────┼───────────────────────────┤  ← draggable splitter
│ Source       │  Timeline (waveform +     │
│ (file/mic/   │  window range)            │
│  system/…)   │                           │
└──────────────┴───────────────────────────┘
```

(The native window title bar sits above the Toolbar; it is not shown here.)

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
  **Replace…** button reveals it again (it stays until dismissed), so the source can
  still be changed.

The row (and the Sidebar) keeps its own **draggable splitter**: the height is clamped
so the Workbench keeps a usable minimum, and the sidebar width is clamped to
160–520 px. The splitter above the row is only shown **when the Timeline is** (the
compact "Add audio" state has a fixed height).

## Desktop-app conventions

- The **native window title bar** carries the app name ("Hey Listen").
- A **native application menu** carries the document actions: **File** (New /
  Open… / Open Recent → up to 10 files + Clear Menu / Save / Save As… —
  `CmdOrCtrl+N` / `O` / `S` / `Shift+S` — plus Close on macOS / Quit elsewhere),
  **View** (fullscreen), **Window** (minimize/maximize), and **Help** / About. On
  macOS the standard application menu (About / Services / Hide / Quit) precedes
  them. File actions are emitted to the frontend via `app:menu`; the rest are
  native. An **Edit** menu carries **Undo** (`CmdOrCtrl+Z`) and **Redo**
  (`Shift+CmdOrCtrl+Z`) for the app-level edit history (see
  [`roadmap.md`](roadmap.md) → Backlog). See `src-tauri/src/menu.rs`. The
  **Toolbar shows the current project name** — the file actions live in the File
  menu, not in the Toolbar.
- The in-app **Toolbar** has no title/branding — it holds app-level actions and
  status only. No hero/header like a website. It carries the app-level audio
  controls (the **filter bypass toggle**, the preview **output gain + device**, and
  the preview **output meter** which reads the core's playback level via
  `output_level`, all driving the core, ADR-9), the **Analysis params** popover (the
  shared, synced analysis params — see [`analysis-tools.md`](analysis-tools.md)), and
  a **View** popover for the UI scale, theme, and the bottom-row layout. The
  temporary **`Rust backend:`** status (the M0 IPC-ping scaffold) is gone.
- **Numeric inputs** support **drag-to-adjust** — drag up to increase, down to
  decrease (Shift for fine control) — in addition to typing. There is no slider; an
  `ns-resize` cursor is the only affordance. This covers the Kobalte `NumberField`s
  (timers, frequency range, per-tool params), the graph nodes' inline params, and the
  synth length (`src/lib/dragNumber.ts`).
- A user-adjustable **font size / UI zoom** (0.8–1.4×) scales the whole interface;
  it lives in the toolbar **View** popover and is persisted.

## Scrolling

Lists (the Sidebar tool list, the graph palette) use a custom `ScrollArea`
(`src/components/ScrollArea.tsx`). macOS WKWebView shows an overlay scrollbar that
ignores `::-webkit-scrollbar` / `scrollbar-width`, so the viewport is
`overflow: hidden` and the content is **translated** by `scrollTop` ourselves —
wheel/trackpad and the draggable thumb drive the same signal, giving a consistent
bar on every platform with no native scrollbar.

## Theming

The app ships an **auto / dark / light** theme, chosen in the toolbar **View**
popover and persisted. It drives the UI via CSS custom properties (`data-theme` on
the root) **and** the charts: the uPlot series/axis colours, the spectrogram canvas
background and colormap, and the dockview theme all follow the active theme.

## Fixed regions

| Region | Role | Notes |
| --- | --- | --- |
| **Timeline** (bottom-right) | waveform + analysis-window range slider | grows while recording; zooms on short windows; drag start/end previews playback, or drag the whole window by its top handle; pick a channel or downmix to mono for multichannel sources; **overlays the filtered signal** when a filter is active (with an on/bypassed badge) |
| **Sidebar** (top-left) | tool picker | opens Workbench tabs — analyzers first (grouped by domain), then the graph editors; a search box filters the analyzer list |
| **Workbench** (top-right) | hosts the Workbench tabs via `dockview` | the only tabbed area |
| **Source** (bottom-left) | audio source picker (file / mic / system / process / mix / synth) | changing the source replaces the whole timeline |

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
  and a *new* tool always opens in the main window.
- **Analyzer popouts** are offered (graph editors stay in the Workbench: their state
  is frontend-only). A popout pulls the project's shared state
  (`timeline`/`params`/`toolOptions`/`views`/`project`) on load and pushes its own
  edits back, so the analysis window, chart zoom, and params stay in sync **across
  windows**; a project window closes its popouts when it closes, and popouts are
  re-created on project load.
- Each analyzer tab has a **params popover** and an **about popover**.
- A **busy indicator** shows progress without blocking: the **first** computation
  (nothing to show yet) spins in the **centre** of the tab; a **recompute** (params
  or window change while a result is on screen) spins in the **bottom-right corner**
  so the stale result stays visible.
- Analyzer charts **zoom on scroll** and carry an on-chart **zoom control**
  (zoom in / out / fit with a range readout); the spectrogram also **pans by
  dragging** (wheel zooms time, Shift+wheel zooms frequency).
- Axis labels stay **un-truncated** — sized margins and formatted ticks/units (the
  charts and the Timeline ruler).
- **Zoom and cursor are synced across analyzer tabs** (where relevant): every
  uPlot chart shares one `createPluginBus` (`state/chartSync.ts`), so the hovered
  cursor is mirrored onto the others and x-zoom is shared within a group (time
  charts follow each other; the spectrum group follows frequency). The canvas
  spectrogram / matrix views join the time group too. Zooming **cannot** go beyond
  the data's x extent (the range is clamped). Cross-tab **and cross-window** zoom is
  synced: a chart's view is pushed to the core as `view:time` / `view:freq` and
  applied in the project's other windows (ADR-11).

## Sidebar

The Sidebar's **width is draggable** (a splitter between it and the Workbench,
clamped to 160–520 px). It lists every available analyzer tool (see
[`analysis-tools.md`](analysis-tools.md)) and, below them, the two graph editors —
**analyzers come first**, grouped by domain (time / spectral / pitch / rhythm /
**loudness). A **sticky search box** at the top filters the analyzer list by
title, description, and keywords; the graph editors are always shown. Clicking an
entry opens its tab in the Workbench (no-op if already open; selects the existing
tab).

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
