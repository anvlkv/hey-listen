# 001 — Find your way around the window

**In short.** One recording, one screen. The regions of that screen never move, so once
you have read them once, you can go straight to the part you need. Only the Workbench is
tabbed.

![The whole window](assets/001-shell.png)

## The simple path

1. **Toolbar** (top). The project's name and its previous/next arrows, the shared
   analysis parameters, the preview output (gain, level, device), Appearance, MCP, and
   the Annotations toggle.
2. **Activity bar** (far left). One tab per analyzer section — *Time domain*, *Spectral*,
   *Pitch / melody*, *Rhythm / tempo*, *Loudness*, *Perception* — then *Graphs*. **Sources**
   and **Export** are pinned at the bottom.
3. **Sidebar**. The content of the selected activity: searchable tool entries, the graph
   editors, the source controls, or the audio export.
4. **Workbench** (centre). The largest area. Analyzers and graph editors open here as
   tabs, and only here.
5. **Annotations** (right). The notes this project carries. Collapse it from the Toolbar.
6. **Timeline** (bottom). The waveform, the analysis window, and the transport. It stays
   mounted from the start, with a placeholder until a source arrives.

Choosing the activity-bar tab that is already showing **collapses** the Sidebar and gives
its width to the Workbench. Sources and Export are Sidebar views, not separate regions:
they sit where the analyzer list would be.

## Advanced — options and keys

- Drag the dividers to resize. Each region keeps a minimum, so the Timeline can never be
  dragged away entirely.
- Reopen, reorder, split, join, or pop out a tab from its tab strip. A popped-out
  analyzer is still the same view of the same project.
- **Tabs (n)** at the top right of the Workbench lists every tab and searches them, which
  beats hunting a truncated title.
- Right-click a tab for its actions: *Compare with…*, *Pop out to window*, the exports,
  and *Close tab*.

| Key | Does |
| --- | --- |
| `F6` / `Shift+F6` | Move focus to the next / previous region |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous Workbench tab |
| `Cmd/Ctrl+1` … `9` | Activate that Workbench tab |
| `Cmd/Ctrl+K` | Command palette: run any command or open any tool |
| `?` | Keyboard Shortcuts, including the native menu's fixed keys |
| `Cmd/Ctrl+Shift+F` | Focus the Sidebar's search box |

## With an agent

An agent sees the same project, not a copy of it. `get_state` reports the source, the
analysis window, the shared parameters, the open tools, and the project's name and path,
so it can orient itself before it changes anything.

`open_tool` opens or focuses a tab. On the bridge it can also **split** the Workbench, so
several results can be seen side by side rather than stacked:

```text
open_tool { tool: "spectrogram" }
open_tool { tool: "spectrum",   position: { direction: "right" } }
open_tool { tool: "spectralCentroid", position: { referenceGroup: "spectrogram", direction: "below" } }
```

`close_tool` closes one; `list_projects` and `open_project_window` work across windows.

## From the command line

There is no window headless, so there is no layout to drive. Use the CLI to find names
and to script work on files:

```sh
hey-listen-cli analyzers          # every analyzer id, section and one-line description
hey-listen-cli nodes              # every filter/synth node kind a DOT graph may use
hey-listen-cli project --help     # build a .heyl (including which tabs it reopens with)
```

A project built with `--open-tool` restores those tabs when the app opens the file, which
is the closest a script gets to setting up the Workbench.

Next: [Open, record, or synthesize a source](002_sources.md)
