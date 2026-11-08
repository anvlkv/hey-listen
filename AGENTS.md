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
   `data-model.md`, `project-file-format.md`, `analysis-tools.md`,
   `analysis-metrics.md`, `mcp-cli-ergonomics.md`). `docs/` is the source of truth for
   design; keep it in sync when decisions change.

2. **Deliver one milestone at a time.** The roadmap is implemented incrementally.
   Do not jump ahead or build unplanned features. Treat each milestone as a
   self-contained, validated unit; finish and validate it before starting the next.
   Only start a milestone when asked.

3. **Load the relevant skill before touching a domain.** See the table below. Use
   the skills for exact APIs/signatures — do not guess or fabricate.

4. **Make minimal, focused changes** that match the existing structure and style.

5. **Validate before claiming done:**
   - **Fresh checkout:** run `npm run sidecar` once before any `cargo` command. Tauri's
     build script resolves `bundle.externalBin` (`src-tauri/binaries/hey-listen-cli-<triple>`)
     on every `cargo` invocation, not just `tauri build` — see `docs/packaging.md`.
   - `npm run typecheck` and `npm run build` (frontend)
   - `cargo check` in `src-tauri/` (Rust; first build is slow — many deps)
   - `npm run maid` — the quality gate (prettier, eslint, the 400-line budget,
     duplication, dead code, Rust fmt + clippy). The git hooks run it for you: fast
     checks on commit, the whole gate on push. See `docs/code-hygiene.md`.
   - State exactly what you ran and saw.

6. **npm cache note:** `~/.npm` on this machine may contain root-owned files and
   throw `EPERM`. Work around with a project-local cache:
   `npm_config_cache=/Users/anvlkv/Projects/hey-listen/.npm-cache npm install …`
   (the `.npm-cache/` dir is gitignored), or fix permanently with
   `sudo chown -R 501:20 ~/.npm`.

7. **Iterating on the UI without the app.** `npm run dev`, then open
   `http://localhost:1420/preview.html` to render the real shell in a plain browser
   (it stubs the Tauri internals) — handy for layout/CSS work and screenshots. See
   `docs/testing.md` → "Rendering the UI without the app".

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

- **Timeline, Sidebar, Workbench, Source, and Annotations are fixed regions, not
  tabs.** The only tabs are Workbench tabs — the **graph editors** (`filter` / `synth`,
  see ADR-10) and the **analyzer tabs** — and they live inside the Workbench (managed by
  `dockview`).
- **One window = one project = one source.** Changing the source replaces the
  whole timeline.
- **Analysis runs off the main thread** — Rust async command + `spawn_blocking`,
  debounced auto-run, with an optional explicit **Run** button for expensive
  tools. See `docs/architecture.md` → "Analysis execution model".
- **No duplicate analyzer tabs**; shared params (FFT size, hop/overlap, window
  function, channel, frequency range) are synced across tools.
- **Keep the maid green.** Source files stay **under 400 lines** — the budget in
  `scripts/maid-baseline/fileSizes.json` only ratchets down, so split a file instead
  of raising it. No new duplication, no dead code, both languages formatted.
  `src/bindings/**` is **generated** by `cargo test`: never hand-edit or format it.
  See `docs/code-hygiene.md`.
- **No copied blocks.** Before writing a second copy of a test hook, WAV/fixture
  writer, chart-image registration, uPlot plugin stack, `SaveProject` literal, or
  switch/toolbar CSS rule, extract it:
  - Rust test fixtures used by more than one target → `src-tauri/tests/support/*.rs`,
    pulled in with `include!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/support/…"))`.
  - Shared derive lists → one `macro_rules!` (see `id_enum!` in
    `audio/analyzers.rs`), never two expanded blocks.
  - Chart-image registration (`useUplotImage` / `useCanvasImage`) →
    `components/analyzer/chartImage.ts`.
  - A uPlot stack shared by two views → `components/compare/CompareTimeChart.tsx`.
  - Tab chrome shared by the two graph editors →
    `components/graphEditor/GraphTabChrome.tsx`.
  - WebdriverIO spec hooks → `e2e/support/session.ts` (`projectSessionHooks`).
  - Param tables in `src/lib/graph/kinds/*` → one small builder per row (see
    `reverb.ts`).
  - Cross-file CSS common rules → `src/styles/shared.css` (combined selectors).
  - A list, table or count restated in a second doc or code comment → the owning doc/enum,
    **linked or imported** from the other. The clone gate ignores `**/*.md`, so review docs
    by hand; two copies of a list are a clone even when the text differs.
  The clone gate is a ratchet: fix the clone, then lower `threshold` in
  `.jscpd.json` in the same change.
- **One list, one place.** A doc, a comment, a test table and a frontend matrix must
  not each restate the same list. Pick the owner (`docs/analysis-tools.md`, the
  `AnalyzerId` enum, `src/state/analyzer/types.ts`) and have the others **link or
  import** it — `e2e/support/tools.ts` imports `AnalyzerId` and `AnalyzerView`
  instead of spelling either union out. When two surfaces must agree, add a test that
  they agree rather than a comment that says they should.
- **Doc comments follow the vocabulary below.** A comment that repeats a doc's list
  of ids, view kinds, or counts is a future contradiction: link to the type/doc and
  keep the list in one place.

## Typed identifiers — no string ids (M15.B, ADR-28)

Enumerable ids are **enums**, not strings. A string is parsed **once at a boundary**
(serde/IPC, CLI or MCP args, a project-file load, a URL) and then dropped; every
internal signature, field, map key and return value takes the enum.

**Existing id enums — extend these, do not add a parallel `String`:**

| Domain | Enum(s) |
| --- | --- |
| Analyzer tools | `AnalyzerId`; `ToolId` adds `filter` / `synth` |
| Result family / Sidebar grouping | `Family`, `Section` |
| Sources | `SourceKind` (project), `CaptureKind` (live picker), `CaptureEventKind` |
| Window function | `WindowKind` |
| Actions / chrome | `MenuAction`, `ThemeBase`, `ThemeMode`, `BatchCommand` |

This applies to **transient/UI state too**, not just project data: compare views
(`CompareView.tool`), tool popouts (`WindowRegistry.popout_tools`) and capture
events (`CaptureEvent.kind`) are ids and must stay typed.

**Rules**

1. Never add a `String` / `&str` field, parameter, map key or return value for an id
   that has (or should have) an enum. Do not compare ids to string literals in Rust
   outside wire-format tests.
2. Parse at the boundary (`FromStr` / serde). An unknown id is an error **there**,
   not a later `_ =>` fallback or a silently accepted arbitrary string.
3. For a new id domain, define one enum derived with
   `strum::{EnumString, Display, AsRefStr, IntoStaticStr, EnumIter, VariantNames}` +
   `serde` + `ts_rs::TS`:
   - Keep the wire spelling identical: `#[serde(rename_all = …)]` and
     `#[strum(serialize_all = …)]` must agree.
   - If it crosses `postcard` (the project file), encode it as a **string** with
     hand-written serde — see `src-tauri/src/audio/analyzers/id.rs` and
     `SourceKind`. Never make it an internally-tagged enum (ADR-2).
   - Regenerate `src/bindings/` with `cargo test` **from `src-tauri/`**; never
     hand-edit the generated files.
4. The frontend imports the generated types (`AnalyzerId`, `ToolId`, `SourceKind`,
   `CaptureKind`, …). Do not redeclare a union or `as`-cast a string into one.
5. Keep the wire unchanged and pin it: add a string-serde / `postcard` round-trip
   test for each new id enum, and a test that the id ↔ catalog ↔ result tag agree.
6. Before finishing, review the diff for id literals and for `String` / `&str` on
   id-shaped fields and signatures. Every remaining hit must be a genuine boundary
   string: a path or file name, a user label or window label, an option / summary
   key, an MCP tool name or schema key, a theme id, or a `GraphNode.kind` (the
   open-ended fundsp mirror). If it names an analyzer, source, capture event,
   window function, menu action, theme base/mode or CLI subcommand, it is a bug.

## Canonical vocabulary (docs and code comments)

Four different "kind" vocabularies exist. Do not mix them; name the one you mean.

| Term | Where | Values |
| --- | --- | --- |
| **`Section`** | Sidebar grouping | `time` / `spectral` / `pitch` / `rhythm` / `loudness` |
| **`AnalyzerView["kind"]`** | Frontend renderer (`src/state/analyzer/types.ts`) | `waveform` / `series` / `spectrum` / `spectrogram` / `matrix` / `rhythm` / `readouts` / `noteMetrics` / `modulation` |
| **`Family`** | Rust result shape / MCP `get_analyzer` / shaping | `scalar` / `series` / `spectrum` / `spectrogram` / `matrix` / `events` / `notes` |
| **`CompareViewFamily`** | Compare view dispatch (`src/state/compare/id.ts`) | a display superset: the `Family` names plus `modulation` / `waveform`, with `scalar` for readouts |

- **Annotation** (M14) is what the user writes. Every layer says so: the stored type is
  `Annotation` (`bindings/Annotation`, `AnnotationValues`), the file's `ANNOTATIONS`
  section, the `*_annotation` MCP tools, the `annotations` CLI subcommand, the
  `annotations` UI-state and chart-bus keys, the `annotation.*` / `annotations.*` test ids,
  `annotation` window kind, `state/annotations/`, `components/annotations/`,
  `AnnotationsPanel`, `annotationPlugins.ts`, `lib/annotation.ts`, and
  `ANNOTATION_STRIP_H` (the annotation lane's height).
- **A note is musical.** Only the `noteMetrics` analyzer's detected segments are called
  notes: `NoteSegmentChart`, `noteSegments.ts`, `noteSegmentPlugins.ts` and the `notes`
  result family. Never use "note" for an annotation — not in prose, UI copy, ids, test ids
  or file names.
- **Preserved musical vocabulary — do not rename.** `Family::Notes` (wire `notes`),
  `NoteMetricsResult.notes` / `gaps` / `noteCount`, `NoteMetric`, `noteMetrics`,
  `note_metrics`, `minNoteMs` / `min_note_ms`, `NotePair` / `NotesDiffDto` /
  `NotesDelta`, `CompareNotes`, `NoteSegmentChart`, `NoteSegment*`, `noteSegments.ts`,
  and the `note-segments-*` CSS classes.
- **Never bulk-rename one word across the tree.** `note` has two meanings, so a global
  substitution silently rewrites the musical vocabulary (and `annotation` is not a
  synonym for an English "note"). List the preserved identifiers above first, replace
  deliberately, then grep the diff for `\bnote`, `per-annotation`, `annotation metrics`,
  `annotation segment`, `a annotation`, and `\bNOTES\b`; every hit must be justified.
- **Names must match the code.** A `///` / `//!` comment or a doc table that names a
  type, module, test, file or field uses the identifier that actually exists. If it needs
  a list, link to the owner (the enum or the owning doc) instead of restating it.
- **Display copy says "annotation".** The rail is **Annotations**; its actions are *Add
  annotation*, *Add an annotation at the playhead*, *Add annotation here*, *Save the
  annotation* and *Drag to add an annotation*. When you rename a user-facing action, rename
  its test id in the same change — `e2e/support/selectors.ts` is the only place the
  strings live, and the specs address it through `SEL`.
- **Selected** is the persisted state (`selectedAnnotationId`); **Select** is the action
  (`selectAnnotation`), mirrored by the MCP tool `set_selected_annotation` and
  `get_state.selectedAnnotationId`. ADR-19's "focus" means "the panel's selected
  annotation".
- **`WindowKind`** is our enum; `WindowFn` is oxiaudio's. **`SourceKind`** is the
  project enum; qualify **`flexaudio::SourceKind`** when you mean the crate's.
- **`SourceData`** is the core's PCM buffer (`crate::state::SourceData`). The file's
  `DATA` section and `SaveProject.pcm` field keep their own names.
- **`AnalyzerId`** vs **`ToolId`**: `ToolId` adds `filter` / `synth`. There is no
  `AnalysisResult::Any...` Rust type; the frontend's result union is
  `AnyAnalysisResult`.

**Counts are never prose.** Write “every analyzer in `AnalyzerId`”, not “29 tools”; a
count in a doc, a test table, or a comment goes stale silently. When a tool is added,
update in one change: `AnalyzerId` + `family_of`/catalog/options, the frontend
`defs/`, `e2e/support/tools.ts` (the smoke matrix), and any doc that *lists* ids —
never a bare number.

## Layout

```
src/          SolidJS frontend (UI, layout, charts, graph editor)
src-tauri/    Rust core (commands, audio engines, project store)
docs/         Planning docs (source of truth for design)
```

## Milestones

`docs/roadmap.md` tracks progress (M11, M12, M14–M21, M21.A, M21.B, M25 and its A/B/C/D
follow-ups are done; **M22 live synth, M23 timeline ergonomics and M24 keyboard are
planned**, as are M13 templates and M26–M31 psychoacoustics). Deliver strictly one
milestone at a time; confirm current status from that file before starting.
