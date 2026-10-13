# Analysis templates

A **template** is a named, **source-less** analysis preset: the same settings, tools,
filter / synth graphs, window policy, and Workbench layout, reusable across different
sources. You build a setup you like, save it as a template, and apply it to the next
recording — the analysis window moves to fit the new source instead of pointing at a
stale span.

A template is *almost* a project file without the audio: the project's `SETUP`
(`AnalysisSetup`) already holds the shared params, tool options, open tools, window,
view, and filter flag, and the `LAYOUT` (dockview JSON + graph node positions) already
round-trips. A template is those two, plus a **window policy** and the **graphs**,
stored as human-readable JSON.

## Goal

- Reuse a **setup** across sources: shared params, per-tool options, open tools, the
  filter graph, the synth graph, and the Workbench arrangement.
- The **window may move**: a template records *how* to map its window onto a new source
  (fractional / absolute / full / fixed length), not just a frozen `start..end`.
- Templates are **portable files** (JSON), shareable and diffable — not the binary
  `.heyl` container (no PCM, no magic header).
- Reachable from the UI, the MCP server, and the batch CLI.

## Relationship to the project file

| | Project (`.heyl`) | Template (`.heyltemplate`) |
| --- | --- | --- |
| Container | binary (postcard + raw PCM) | JSON |
| Contains audio | yes (`DATA` section) | no |
| Contains source descriptor | yes (provenance for the picker) | no (source-agnostic) |
| Contains setup | yes (`SETUP`) | yes |
| Contains layout / graphs | yes (`LAYOUT`) | yes (optional) |
| Applies to | *is* a project | the **current** project's setup |

The template payload deliberately reuses the Rust `AnalysisSetup` / `GraphSpec` types
(`src-tauri/src/project/sections.rs`), which already derive `Serialize`/`Deserialize`
and are exported to TypeScript, so there is no second schema to maintain.

## Template file

Extension `.heyltemplate`; JSON content (`src/state/templates.ts`):

```jsonc
{
  "kind": "hey-listen.template",
  "formatVersion": 1,
  "meta": {
    "id": "podcast-voice",
    "name": "Podcast voice",
    "description": "Mono downmix, 75% overlap, pitch + loudness, LP filter",
    "createdMs": 1730000000000,
    "appVersion": "0.2.0"
  },
  // The shared analysis setup (mirrors AnalysisSetup).
  "setup": {
    "shared": { /* SharedParams */ },
    "toolOptions": { /* tool id -> param -> value */ },
    "openTools": ["spectrogram", "pitchYin", "loudnessIntegrated"],
    "filterEnabled": true
  },
  // How to map the stored window onto a differently-sized source (see below).
  "windowPolicy": "fractional",       // "fractional" | "absolute" | "full" | "fixedLength"
  "window": { "startSecs": 0.0, "endSecs": 4.0 },
  "viewPolicy": "fractional",          // "fractional" | "full" | "keep"
  // Optional graphs (the "same filtering / same synthesis" part).
  "filterGraph": { "nodes": [ /* … */ ], "edges": [ /* … */ ] },
  "synthGraph":  { "nodes": [ /* … */ ], "edges": [ /* … */ ] },
  // Optional Workbench arrangement (dockview JSON + per-graph node positions).
  "layout": {
    "dockview": { /* dockview api.toJSON() */ },
    "graphs": { "filter": { /* node positions */ }, "synth": { /* … */ } }
  }
}
```

- **`filterGraph`** is the fundsp filter (same `GraphSpec` the Filter editor builds and
  `set_filter_graph` installs). Applying it reproduces the exact conditioning
  (e.g. a high-pass before every analysis).
- **`synthGraph`** is the synth editor graph; a template can seed a synth *source* (or
  just restore the editor).
- **`layout`** is optional: a light template (settings only) omits it; a heavy template
  restores the tab arrangement and node positions too.

## Window / view policies

Because a template is source-agnostic, its window must be interpreted against the new
source's duration `D`:

| Policy | Mapping |
| --- | --- |
| `fractional` (**default**) | `start = s·D`, `end = e·D`, clamped to `[0, D]`. Same *relative* region — the natural default for "same settings, different source". |
| `absolute` | keep `start..end` seconds, clamped to `[0, D]`. |
| `full` | select the whole source (`0..D`). |
| `fixedLength` | keep the window's *length* (`end − start`), anchored at `start` (or `0`), clamped. |

`viewPolicy` does the same for the timeline zoom: `fractional` (default), `full` (fit
the new source), or `keep` (leave the current view alone). Applying always clamps so the
window/view stay inside the new source.

## Applying a template

Reuses the project's own restore path (`src/state/project.ts` `applyProject`,
`state/graph.ts` `loadGraph`, `state/workbench.ts` `restoreLayout`,
`state/timeline.ts` setters):

1. **Confirm** if the project is dirty (reuse the `confirm` command) — applying replaces
   the current setup.
2. **Setup** — `applySharedParams(setup.shared)`, replace `toolOptions`, set
   `filterEnabled`.
3. **Graphs** — `loadGraph("filter", filterGraph)`, `loadGraph("synth", synthGraph)`
   when present (before the tabs mount, so restored graph tabs show them).
4. **Open tools** — open the template's `openTools` (respecting the **no duplicate
   tab** rule; existing tabs are kept).
5. **Window / view** — map per the policies against the current source duration.
6. **Layout** (if present) — `restoreLayout(dockview)` + graph node positions, last, so
   the arrangement mounts against the restored state.
7. Reset the undo history boundary is *not* needed (a template is an in-place edit), but
   a template apply **is** one undo step.

Applying does **not** touch the source or its descriptor: a template can be applied to a
project that already has audio, or to a fresh empty project (the setup is simply staged
until a source exists).

> **New project from template** — a variant that creates a fresh project and stages the
> template's setup before a source is chosen (for a "start a session the same way every
> time" flow).

## Operations and storage

Templates live in the app **config** directory, mirroring `recent.rs`:

```
<app config dir>/templates/<id>.heyltemplate
```

Rust module `src-tauri/src/templates.rs` + `src-tauri/src/commands/templates.rs`:

| Command | Purpose |
| --- | --- |
| `list_templates` | Installed templates' `meta` (for the picker). |
| `read_template(id)` | The full template payload. |
| `save_template(name, description, payload)` | Write from the current setup (`state/project.ts` `currentSetup`/`currentLayout`). |
| `delete_template(id)` / `rename_template(id, name)` | Manage the list. |
| `templates_dir` | The folder (shown in the UI, so a user can drop files in). |
| `import_template_file(path)` / `export_template_file(id, path)` | Copy a `.heyltemplate` in/out via native dialogs. |

The frontend assembles the payload (it owns the stores) and Rust stores bytes, exactly
like project save. Validation (kind / `formatVersion` / shape) happens in
`src/state/templates.ts`; an unknown/newer version is refused with an inline error rather
than applied partially.

## UI

- A Toolbar **Templates** popover: the list (apply on click), *Save current as
  template…* (name + description dialog), *Import…* / *Export…* / *Delete* / *Reveal
  folder*.
- The native **File** menu gains **Templates ▸** (Apply / Save as Template… / Import /
  Export) next to Save, so it is reachable without the popover.
- Applying from the Source panel ("start from a template") is the *new project from
  template* variant.

## CLI / MCP surface (usable from both)

The template's **compute subset** (shared params, tool options, filter graph, window
policy) is enough to make an analysis reproducible headless; the **layout / dockview**
part is GUI-only.

- **MCP** (`src/state/mcp.ts` + `mcp/tools.rs`):
  - `list_templates` — installed templates (works headless: they are JSON on disk).
  - `apply_template { id | path, source? }` — apply setup + graphs + window policy to the
    current project (GUI) or to the headless session (compute subset).
  - `save_template { name, description? }` — capture the current setup (GUI; headless
    captures the session's shared params + options + filter only).
  - `export_template { id, path }` / `import_template { path }`.
- **Batch CLI** ([`cli.md`](cli.md)): `analyze` / `synth` gain
  `--template <FILE.heyltemplate>`, which applies the template's shared params, per-tool
  options, filter graph, and window policy (against each file's duration) before running
  the analyzers — so `hey-listen analyze *.wav --template voice.heyltemplate` reproduces
  a saved setup over a folder. Only the compute subset applies headless (no tabs / no
  layout).

## Files

| Path | Role |
| --- | --- |
| `src/state/templates.ts` | Template type, validate, assemble-from-stores, apply, window policies. |
| `src-tauri/src/templates.rs`, `src-tauri/src/commands/templates.rs` | Storage (config dir) + list/read/write/delete/import/export. |
| `src-tauri/src/project/sections.rs` | `AnalysisSetup` / `GraphSpec` reused as the payload (no new schema). |
| `src/state/project.ts` | `currentSetup` / `currentLayout` (assemble), `applyProject` pieces (apply). |
| `src/components/Toolbar.tsx`, `src-tauri/src/menu.rs` | The Templates popover + File ▸ Templates. |
| `src-tauri/src/cli/batch.rs` | `--template`. |
| `src/state/mcp.ts`, `src-tauri/src/mcp/tools.rs` | The `*_template` tools. |

## Testing

- **Payload round-trip** — `save_template` → `read_template` → `apply_template`
  reproduces the shared params, tool options, filter graph, and open tools (Rust unit
  tests over a synthetic setup; frontend tests over the store assembly).
- **Window policies** — each policy maps correctly for `D` longer, shorter, and equal to
  the stored span (including the empty/degenerate source).
- **CLI** — `analyze --template` applies the setup before analysis; a bad/unreadable
  template is a usage error (exit `2`).
- **E2E (wdio)** — save a setup as a template, open a different source, apply it, assert
  the window moved and the filter graph is installed.

See [`roadmap.md`](roadmap.md) → **M13** and [`decisions.md`](decisions.md) → **ADR-17**.
