# Hey Listen — user manual

Hey Listen measures a sound, and keeps what you learn beside it. This manual follows the
app you can open today, one task per chapter.

## Start with the question

| You want to… | Read |
| --- | --- |
| Find where something happens in a recording | [001](001_shell.md), then [003](003_timeline.md) |
| Know what a moment sounds like by the numbers | [005](005_analyzers.md) |
| Clean up or isolate part of the signal | [004](004_graphs.md) |
| Keep a decision you made, with its evidence | [006](006_annotations.md) |
| Check one recording against another | [007](007_compare.md) |
| Hear the window and work without the mouse | [008](008_preview.md) |
| Save the project, or take the data elsewhere | [009](009_projects.md) |
| Bring in audio, or make it | [002](002_sources.md) |
| Let an agent do the first pass | the *With an agent* layer in any chapter, then [the agent reference](audio-analysis/SKILL.md) |

## How each chapter is layered

Read the top once; afterwards, jump to the layer you need. The middle section is named
for the task it completes, not for a fixed stage.

| Layer | What it gives you |
| --- | --- |
| **In short** | The question the chapter answers, in a few sentences. |
| **The task** (chapter-named) | The steps that get the job done, in the order you do them. |
| **Advanced — options and keys** | Every control in that area, and only the shortcuts that belong to it. |
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
| [005 — Measure what the window contains](005_analyzers.md) | Which tool answers which question, and how to read it |
| [006 — Keep what you find](006_annotations.md) | Annotations: the note, the frozen values, the trail |
| [007 — Compare two projects](007_compare.md) | A/B and Δ, alignment, and when a delta is unreliable |
| [008 — Listen, and drive by keyboard](008_preview.md) | Transport, speed, shortcuts, and rebinding |
| [009 — Keep, undo, and take the data out](009_projects.md) | The `.heyl` file, undo, JSON/CSV/PNG/audio export |
| [010 — Change the look, update, read the log](010_appearance_and_log.md) | Themes, updates, the CLI install, the app log |
| [011 — When something goes wrong](011_errors.md) | Where a failure appears, and how to get back |

## A project to follow along

The examples come from one recording: a Grieg prelude with a 31-second loop framed as the
analysis window, and the annotations that record why that loop was chosen. When you open
that project and follow a chapter, the numbers in one picture match the next. The
comparison chapter adds a second, shorter project so there is something to compare
against.

## The same work, for an agent

An agent drives the same engine over the Model Context Protocol (MCP) or the batch CLI.
The reference for that surface sits with this manual, so the two never disagree:

| Page | Covers |
| --- | --- |
| [Driving the analysis engine](audio-analysis/SKILL.md) | Which surface to use, and the workflow both share |
| [MCP server](audio-analysis/mcp.md) | Tools, tabs, windows, projects, annotations, export |
| [Batch CLI](audio-analysis/cli.md) | `analyze`, `nodes`, `synth`, `compare`, `project`, `annotations` |
| [Analyzers](audio-analysis/analyzers.md) | What each tool is for, and where it is not the right one |
| [Filter and synth graphs](audio-analysis/graphs.md) | Node catalog, DOT, subsystems, sound design |

Each chapter above ends with the one or two calls that do its work, so the agent layer is
never far from the place you learned the task.
