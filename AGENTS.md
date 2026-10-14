# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

**Hey Listen** — an audio analysis workbench. Capture, filter, and analyze audio
from files, live inputs (mic / system / process / mix), and fundsp synthesis;
save source + setup + results to a binary project file.

- Shell: Tauri 2 (Rust core) + SolidJS/TypeScript frontend (Vite).
- One window = one project = one audio source.
- See `README.md` for an overview and `docs/` for the plan.

## Workflow

1. **Read the plan first.** Start with `docs/roadmap.md` and the doc for the area
   you're touching (`architecture.md`, `ui-layout.md`, `source-model.md`,
   `data-model.md`, `project-file-format.md`, `analysis-tools.md`). `docs/` is the
   source of truth for design; keep it in sync when decisions change.

2. **Deliver one milestone at a time.** The roadmap is implemented incrementally.
   Do not jump ahead or build unplanned features. Treat each milestone as a
   self-contained, validated unit; finish and validate it before starting the next.
   Only start a milestone when asked.

3. **Load the relevant skill before touching a domain.** See the table below. Use
   the skills for exact APIs/signatures — do not guess or fabricate.

4. **Make minimal, focused changes** that match the existing structure and style.

5. **Validate before claiming done:**
   - `npm run typecheck` and `npm run build` (frontend)
   - `cargo check` in `src-tauri/` (Rust; first build is slow — many deps)
   - State exactly what you ran and saw.

6. **npm cache note:** `~/.npm` on this machine may contain root-owned files and
   throw `EPERM`. Work around with a project-local cache:
   `npm_config_cache=/Users/anvlkv/Projects/hey-listen/.npm-cache npm install …`
   (the `.npm-cache/` dir is gitignored), or fix permanently with
   `sudo chown -R 501:20 ~/.npm`.

## Skills

Load the matching skill (via the `skill` tool) before working in that area:

| Area | Skill |
| --- | --- |
| Tauri core, commands, events, channels, capabilities | `tauri-2` |
| Frontend (SolidJS + TypeScript) | `solid-ts` |
| Workbench docking / tabs | `dockview-vanilla` |
| fundsp graph editor (filter/synth) | `solid-flow` |
| Charts | `solid-uplot` (use `uplot` for chart semantics) |
| Audio capture (mic/system/process/mix) | `flexaudio` |
| File decode / demux | `symphonia` |
| Filtering + synthesis nets | `fundsp-audio` |
| Analysis (spectral, pitch, tempo, loudness, …) | `oxiaudio` |
| End-to-end testing (WebdriverIO + Tauri) | `tauri-webdriver-e2e` |


## Hard rules (from the spec — do not violate)

- **Timeline, Sidebar, Workbench, and Source are fixed regions, not tabs.** The only
  tabs are Workbench tabs — the **graph editors** (`filter` / `synth`, see ADR-10) and
  the **analyzer tabs** — and they live inside the Workbench (managed by `dockview`).
- **One window = one project = one source.** Changing the source replaces the
  whole timeline.
- **Analysis runs off the main thread** — Rust async command + `spawn_blocking`,
  debounced auto-run, with an optional explicit **Run** button for expensive
  tools. See `docs/architecture.md` → "Analysis execution model".
- **No duplicate analyzer tabs**; shared params (FFT size, hop/overlap, window
  function, channel, frequency range) are synced across tools.

## Layout

```
src/          SolidJS frontend (UI, layout, charts, graph editor)
src-tauri/    Rust core (commands, audio engines, project store)
docs/         Planning docs (source of truth for design)
```

## Milestones

`docs/roadmap.md` tracks progress (M11 is done). Deliver strictly one
milestone at a time; confirm current status from that file before starting.
