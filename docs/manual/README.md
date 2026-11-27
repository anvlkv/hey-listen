# Hey Listen — user manual

Hey Listen measures a sound, and keeps what you learn beside it. This manual follows the
app you can open today, one task per chapter.

## How each chapter is layered

Read the top once; afterwards, jump to the layer you need.

| Layer | What it gives you |
| --- | --- |
| **In short** | The question the chapter answers, in a few sentences. |
| **The simple path** | The steps that get the job done, with no options. |
| **Advanced — options and keys** | Every control in that area, and the shortcuts that reach it. |
| **With an agent** | The Model Context Protocol (MCP) tools that do the same work. |
| **From the command line** | The `hey-listen-cli` command for a batch, a script, or CI. |

The agent is an optional outside collaborator, not something inside the app that knows
the answer. Manual use of the window and the CLI are complete on their own. Where a
model is involved — the psychoacoustic analyzers — the manual says so, and says what the
number depends on.

## Chapters

| Chapter | Answers |
| --- | --- |
| [001 — Find your way around the window](001_shell.md) | Which region holds what, and how tabs behave |
| [002 — Open, record, or synthesize a source](002_sources.md) | Where the audio comes from, and where it is stored |
| [003 — Frame the question on the Timeline](003_timeline.md) | What the analysis window is; zoom, channels, snapping |
| [004 — Shape the sound](004_graphs.md) | Filter, Synth, subsystems, and DOT interchange |
| [005 — Measure what the window contains](005_analyzers.md) | Finding a tool, reading a chart, shared parameters |
| [006 — Keep what you find](006_annotations.md) | Annotations: the note, the frozen values, the trail |
| [007 — Compare two projects](007_compare.md) | A/B and Δ, alignment, and when a delta is unreliable |
| [008 — Listen, and drive by keyboard](008_preview.md) | Transport, speed, shortcuts, and rebinding |
| [009 — Keep, undo, and take the data out](009_projects.md) | The `.heyl` file, undo, JSON/CSV/PNG/audio export |
| [010 — Change the look, update, read the log](010_appearance_and_log.md) | Themes, updates, the CLI install, the app log |
| [011 — When something goes wrong](011_errors.md) | Where a failure appears, and how to get back |

## A project to follow along

Every screenshot comes from the same project, `video/story-assets/analysis-example.heyl`:
a Grieg prelude with its analysis window framed on a 31.2 s loop, and the annotations
that record why that loop was chosen. Open it and the numbers in one picture match the
next.

## Regenerating the screenshots

The images in `assets/` are captured from the running app by `e2e/manual/capture.spec.ts`,
driving the example project above:

```sh
npm run capture:manual
```

It needs the desktop app and its WebDriver, like the rest of the end-to-end suite.

The design and history of the app live in [`../development/`](../development/) and
[`../archive/`](../archive/), not here.
