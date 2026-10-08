# UI layout

## The one rule

**Timeline, Sidebar, Workbench, and Source are fixed regions — not tabs.** The
only tabs in the app are **analyzer tabs**, and they live **inside the
Workbench**.

```
┌──────────────┬───────────────────────────┐
│              │  Workbench                │
│   Sidebar    │  (dockview — analyzer     │
│   (tool      │   tabs ONLY)              │
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
  status only. No hero/header like a website.

## Fixed regions

| Region | Role | Notes |
| --- | --- | --- |
| **Timeline** (bottom-right) | waveform + analysis-window range slider | grows while recording; zooms on short windows; drag start/end previews playback; pick a channel or downmix to mono for multichannel sources |
| **Sidebar** (top-left) | analysis tool picker | opens analyzer tabs in the Workbench |
| **Workbench** (top-right) | hosts analyzer tabs via `dockview` | the only tabbed area |
| **Source** (bottom-left) | audio source picker (file / mic / system / process / mix) | changing the source replaces the whole timeline |

None of these are closable, draggable, or tabbed.

## Analyzer tabs (Workbench only)

- Managed by `dockview` (mounted **only** in the Workbench region).
- **No duplicate tabs** — a tool can be open at most once.
- Each tab has a **params popover** to configure the tool.
- Each tab has an **about popover** describing when/how to use that analysis.
- **Zoom and cursor are synced across tabs** (where relevant), via shared chart
  state (solid-uplot `createPluginBus`).

## Sidebar

Lists every available analyzer tool (see
[`analysis-tools.md`](analysis-tools.md)). Clicking a tool opens its tab in the
Workbench (no-op if already open; selects the existing tab).

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
`Button` throughout; **tabs stay dockview's** (analyzer tabs only).
