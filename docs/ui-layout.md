# UI layout

## The one rule

**Timeline, Sidebar, and Workbench are fixed regions — not tabs.** The only tabs
in the app are **analyzer tabs**, and they live **inside the Workbench**.

```
┌──────────────────────────────────────────┐
│ Toolbar                                   │
├──────────────┬───────────────────────────┤
│              │  Workbench                │
│   Sidebar    │  (dockview — analyzer     │
│   (tool      │   tabs ONLY)              │
│   picker)    ├───────────────────────────┤
│              │  Timeline (waveform +     │
│              │  window range)            │
└──────────────┴───────────────────────────┘
```

## Desktop-app conventions

- The **native window title bar** carries the app name ("Hey Listen").
- The in-app **Toolbar** has no title/branding — it holds app-level actions and
  status only. No hero/header like a website.

## Fixed regions

| Region | Role | Notes |
| --- | --- | --- |
| **Timeline** (bottom) | waveform + analysis-window range slider | grows while recording; zooms on short windows; drag start/end previews playback |
| **Sidebar** (left) | analysis tool picker | opens analyzer tabs in the Workbench |
| **Workbench** (center) | hosts analyzer tabs via `dockview` | the only tabbed area |

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
