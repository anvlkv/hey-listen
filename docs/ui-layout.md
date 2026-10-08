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

## Row sizing

The Source + Timeline row has a **fixed, user-adjustable height** — both are the
same height by construction. The splitter above the row is dragged with the
pointer; the height is clamped so the Workbench keeps a usable minimum. The
default is compact (the Source panel's controls are sized to fit it without
scrolling); shrinking the row below the panel's content makes the panel scroll.

## Desktop-app conventions

- The **native window title bar** carries the app name ("Hey Listen").
- The in-app **Toolbar** has no title/branding — it holds app-level actions and
  status only. No hero/header like a website. In M3 it gained the app-level audio
  controls: the **filter bypass toggle** and the preview **output gain + device**
  (which drive the core player, ADR-9).
- **Numeric inputs** gain **drag-to-adjust** (drag up/down to change the value, a
  visual affordance rather than a slider) in addition to typing — M7.

## Fixed regions

| Region | Role | Notes |
| --- | --- | --- |
| **Timeline** (bottom-right) | waveform + analysis-window range slider | grows while recording; zooms on short windows; drag start/end previews playback; pick a channel or downmix to mono for multichannel sources; **planned:** overlay the filtered signal when a filter is active |
| **Sidebar** (top-left) | tool picker | opens Workbench tabs — analyzers first, then the graph editors (M5); a search box filters the analyzer list |
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
- Any Workbench tab can be **popped out** into its own window (M7); the popout
  title shows the tab name + source, and focusing the tab in the main window
  raises the popout.
- Each analyzer tab has a **params popover** and an **about popover**.
- Analyzer charts **zoom on scroll** and carry an on-chart **zoom control**
  (zoom in / out / fit with a range readout); the spectrogram also **pans by
  dragging** (wheel zooms time, Shift+wheel zooms frequency).
- **Zoom and cursor are synced across analyzer tabs** (where relevant), via shared
  chart state (solid-uplot `createPluginBus`) — M5.

## Sidebar

Lists every available analyzer tool (see
[`analysis-tools.md`](analysis-tools.md)) and, below them, the two graph editors —
**analyzers come first** (M5). A **search box** at the top filters the analyzer
list by title and keywords (M5); the graph editors are always shown. Clicking an
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
timeline's source like any other.

Selecting a live kind opens a capture session right away so the **input meter is
live even while idle** (monitoring); Record reuses that session and starts
appending to the timeline. See [`source-model.md`](source-model.md).

The controls are built on `@kobalte/core` primitives — `Select` for the source
kind, `Combobox` for device / application selection, `Slider` for gain,
`NumberField` for the start/stop timers, and `Meter` for the input level — so
keyboard support, typeahead and ARIA wiring come from the toolkit (see ADR-8).
Styling is ours, via Kobalte's `data-*` state attributes. Buttons use Kobalte's
`Button` throughout; **tabs stay dockview's** (the Workbench tabs only).
