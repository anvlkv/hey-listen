# 009 — Projects, undo, and export

## Save and reopen

A project is one window, one source, one workspace. **Save** writes a `.heyl` file that
carries the source, the graphs, the settings, the analysis window, your annotations, the
Workbench layout, and any saved comparisons. Reopen it and you are back where you were.

The Toolbar shows the project name and marks unsaved changes. When you close a project
with unsaved work, Hey Listen asks first. File audio is **embedded**, **linked** by
path, or **live-linked** — see [Open or record a source](002_sources.md).

A linked project whose file has gone missing still opens, with an empty Timeline; a
dialog offers to **locate the file** again, and saving with a link that cannot be
resolved offers to embed the audio still in memory instead of writing a project that
could not reopen.

Older project files open normally and are upgraded on open; save them to keep the
newer format. Open a project from the recent list, from the file picker, or straight from
your operating system.

## Two projects at once

Each project window is independent: its own source, its own window, its own tabs and
popouts. Saving or loading in one leaves the other alone. A popped-out tool belongs to
the project that popped it out — it is a view, not another project.

## Undo and redo

An edit is one step: undo restores it and redo re-applies it. Undo applies to the project,
not to your typing — inside a text field, the usual text undo still applies. Replacing the
source starts a fresh history.

## Export

- **JSON** — a self-describing file with provenance: what ran, on which window, with
  which settings.
- **CSV** — a wide matrix for spreadsheets, with a metadata file beside it.
- **Copy CSV** — the same data onto your clipboard.
- **Export every open analysis** — one file per tool in a folder.
- **Chart PNG** — the chart exactly as drawn, with its theme and zoom.

Data export also works from a script or agent without the window open; the chart image
needs the app.

Next: [Themes, agents, and the command line](010_themes_and_agents.md)
