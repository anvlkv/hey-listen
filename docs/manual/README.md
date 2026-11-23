# Hey Listen — user manual

How to use the app, one task per chapter. Each chapter is grounded in the same behaviour
the end-to-end suite checks, and the screenshots are captured from the running app
(element crops, so you see exactly the region being described).

| Chapter | What it covers |
| --- | --- |
| [001 — The window at a glance](001_shell.md) | Fixed regions, Workbench tabs, resizing |
| [002 — Open or record a source](002_sources.md) | Files, live capture, synth, replacing |
| [003 — Navigate the timeline](003_timeline.md) | Analysis window, zoom, channels, right-click |
| [004 — Filter and synthesize](004_graphs.md) | Graph editors, filter switch, Live, DOT |
| [005 — Analyze the sound](005_analyzers.md) | Finding tools, shared params, reading charts |
| [006 — Annotate what you find](006_annotations.md) | Adding, selecting, Analyze, deleting |
| [007 — Compare two projects](007_compare.md) | A/B overlay, alignment, saved comparisons |
| [008 — Preview and keyboard](008_preview.md) | Transport, speed, shortcuts, rebinding |
| [009 — Projects, undo, and export](009_projects.md) | Save/reopen, undo, JSON/CSV/PNG |
| [010 — Themes, agents, and the command line](010_themes_and_agents.md) | Themes, MCP, CLI, log |
| [011 — When something goes wrong](011_errors.md) | Errors, warnings, and recovery |

The design and history of the app live in [`../development/`](../development/) and
[`../archive/`](../archive/), not here.

## Regenerating the screenshots

The images in `assets/` are captured by `e2e/manual/capture.spec.ts`:

```sh
npm run manual:shots
```

It needs the desktop app and its WebDriver, like the rest of the end-to-end suite.
