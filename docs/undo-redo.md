# Undo / redo as a core project operation

Plan for the undo/redo reimplementation that is a **prerequisite to M24.B** (see
[`roadmap.md`](roadmap.md), [`hotkeys.md`](hotkeys.md)). It replaces the frontend
snapshot history (`src/state/history.ts`, shipped in M8.A) with a history that the
**Rust core owns**, consistent with ADR-11 ("project UI state lives in the core; windows
are views"). It is a reimplementation, not a bug-fix series: the symptoms below are all
consequences of one wrong assumption, and fixing that assumption fixes them together.

## Problem

`src/state/history.ts` is a **per-window, frontend, snapshot-based** history. It predates
— or rather never followed — ADR-11, which moved the project's shared state into the core
(`WindowState::ui`, a key → JSON map with a revision counter and a per-key broadcast via
`set_ui_state` / `ui-state`). The current history therefore:

- **Duplicates ownership.** The frontend snapshots the same state the core already owns,
  by reading the same stores the core writes back to (graphs via `set_filter_graph` /
  `set_synth_graph`, layout via dockview, params/options/annotations via `ui-state`).
- **Is one stack per window.** Each window (main, `popout-*`, `annotation-*`, `compare-*`)
  runs its own bundle and its own stacks, but they project *one* project. Undo is a project
  operation implemented as N independent window operations.
- **Cannot tell local from remote.** Remote `ui-state` patches are applied through the
  same setters the user's edits use, so every peer edit is captured as a local undo step;
  undoing it re-pushes a stale value (ping-pong), and any peer edit wipes the redo branch.
- **Captures too eagerly, at the wrong granularity.** One `createEffect` re-reads and
  deep-clones the whole project (including `layoutJson()` → dockview `toJSON`) on every
  reactive tick; the 350 ms debounce defers only the *commit*, not the *capture*.
- **Has no settle window on reset.** `resetHistory()` seeds its base snapshot a single
  `setTimeout(0)` after load, while dockview re-serializes its layout and popouts reconcile
  over several ticks — so a freshly opened project acquires a spurious undo step (the dirty
  tracker already handles this with a re-arming quiet period; history does not).
- **Is not key-order-stable.** Dedupe is raw `JSON.stringify`, but state that crosses the
  core and back as JSON does not preserve object key order, so a round-trip that only
  reorders keys reads as a change (`dirty.ts` canonicalizes for exactly this reason;
  history does not).
- **Shadows native text undo.** The native menu binds `CmdOrCtrl+Z` / `Shift+CmdOrCtrl+Z`
  to the app-level items, so a focused `<textarea>` / `<input>` never gets native text undo
  (the menu already adds predefined cut/copy/paste for the same reason, but not text undo).

These are the *same* defect expressed differently: **history is kept where it should not be
kept, and reads state it does not own.**

## Decision

**Undo/redo becomes a core-owned, revision-based project operation.** The core already
owns the project's shared state (ADR-11) and already receives the full project content at
save time (the `save_project` command takes source + setup + layout + annotations +
compare + results). The reimplementation closes the gap between those two facts:

1. The core maintains a **single authoritative project-state snapshot** — the same shape
   `save_project` persists — and a bounded undo/redo stack of those snapshots per project
   (not per window).
2. The frontend **pushes project-state changes to the core as they settle** (not only at
   save), so the core can record undo steps. It becomes a projection of the core's state.
3. **Undo/redo are core commands**: they pop a snapshot, compute what changed, and
   broadcast the restore back to every window of the project through the existing `ui-state`
   patch channel (plus the graph/layout restore paths). There is exactly one writer, so the
   local-vs-remote ambiguity, the ping-pong, and the redo-wipe all disappear.
4. **`Mod+Z` / `Shift+Mod+Z` become commands in M24.B's registry** with a text-field guard
   (`allowInInput: false`), not native menu accelerators. The reimplementation introduces
   the *minimal* registry + dispatcher seam (the guard) because undo/redo cannot be bound
   correctly without it — which is precisely why this work is a prerequisite to M24.B rather
   than part of it.

See the proposed **ADR-37** at the end of this document.

## The undoable state: one list, one place

What undo can reach is **exactly what the project file stores**, and the single owner of
that list is [`project-file-format.md`](project-file-format.md) → "Sections". The history
snapshot does **not** restate the list; it is derived from the same project content the
save path writes:

- **Undoable (project content):** `META`-adjacent identity, `SOURCE` (descriptor — *not*
  the PCM), `SETUP` (shared params, per-tool options, `openTools`, window, view,
  `filterEnabled`), `LAYOUT` (dockview + graph positions + popouts + compiled filter spec),
  `ANNOTATIONS`, and the saved `COMPARE` snapshots.
- **Not undoable:** the `DATA` PCM (ADR-21 — the synth re-renders from its graph snapshot,
  and a file/capture source is rederived, never snapshotted), `RESULTS` (a cache, recomputed
  on demand), transport/playhead (ADR-22), chart zoom (per-window, not project content),
  theme/font scale (app-level), and the **live** compare view (ADR-24 — transient).

The invariant is the reverse of today's bug class: **adding a persisted field must fail to
compile unless it is also wired into the snapshot**, and the snapshot type is the
single enforcement point. There is no second list in `dirty.ts`, `history.ts`, or
`snapshot.ts` that can drift — see "Scope: full unification" below.

## Architecture

### Ownership and the snapshot channel

- `WindowState` (the per-project object that already holds `ui`) gains a **project-state
  snapshot** plus two bounded stacks (`undo`, `redo`) and a `canUndo` / `canRedo` flag pair.
- The frontend pushes project-state changes through a **coalesced channel** that mirrors
  `uiSync.ts`: the leading value goes immediately, a burst coalesces into one trailing push
  (the existing 60 ms throttle), always the latest value. This is the same mechanism that
  already keeps popouts responsive during a window drag, now applied to the project state
  the core needs for undo.
- Three currently-separate frontend surfaces converge onto this one channel:
  1. **Shared params / tool options / annotations / selection / window / view** — already in
     `ui-state`; they become part of the project snapshot.
  2. **Filter / synth graph specs** — today pushed only via `set_filter_graph` /
     `set_synth_graph`; they join the snapshot (the compiled spec is already persisted in
     `LAYOUT.filterSpec`).
  3. **Dockview layout + graph positions** — today frontend-only and written only at save;
     they are pushed on a settle so layout edits become undoable. (This is the one genuinely
     new frontend→core push; it reuses the same coalescing so splitter drags do not spam
     IPC.)

### Capture

- A **trailing settle** commits one snapshot per gesture (a drag, a field commit, a tab
  move), matching the existing 350 ms cooperative debounce but owned by the core — so there
  is one recorder per project, not one per window.
- **Lazy capture:** the frontend push signals *that* something changed; the core reads the
  settled snapshot once at commit time. The per-tick whole-project clone disappears.
- **Dedupe by canonical key order** (the `dirty.ts` `canonical()` approach), so a round-trip
  that only reorders keys does not create a step.
- **Reset boundaries:** New, Open, **and a source change** all reset the stack (a source
  change replaces the whole timeline, so history must not step across it — this is a latent
  bug today: `openPath` → `resetTimeline` does not reset history).

### Restore

- Undo/redo pop a snapshot and **diff it against the current one**, then broadcast only the
  changed keys through the existing `ui-state` patch protocol (plus a graph/layout restore).
  This keeps the restore cheap and reuses the proven broadcast path — **per-key whole-value
  patches first**, not RFC 6902 within a value (see "Patches, not JSON Patch", below).
- Windows apply the restore with a **remote** mute flag (the successor to `history.ts`'s
  `applying`): applying a patch must not re-push it. The flag is unnecessary for the core's
  own stack (it is the single writer); it exists only to keep a window from echoing a
  restore back.
- `canUndo` / `canRedo` are part of the broadcast state, so the menu items and M24's `when`
  clauses enable/disable correctly (today the menu items are always enabled and the handlers
  no-op).

### Patches, not JSON Patch (yet)

The core already broadcasts **per-key whole-value** patches (`{ key, value, revision }`) and
tracks a revision counter. Undo reuses that granularity: store full snapshots (bounded), and
on restore diff at the key boundary and emit the changed keys. This is simpler and already
revision-tracked. **RFC 6902 JSON Patch** is the deferred optimization for the day a single
key's value (the annotations list, graph edge lists) is large enough that whole-value
replacement is too expensive to broadcast — introduce it *within* that key then, not now.

## Text editing and the M24.B seam

The native menu's Undo/Redo accelerators are removed. Undo/redo become the **first two
commands** in M24.B's command registry:

- `undo` / `redo` — `allowInInput: false`, `when: canUndo()/canRedo()`, `allowRepeat: false`.
- The dispatcher's guard (never fire in a text field / select / contenteditable) is what
  hands `Cmd+Z` back to native text undo when an input is focused — the same rule that M24.B
  already specifies in `hotkeys.md` → "Guards".

The reimplementation delivers the registry skeleton and that guard as the **minimum viable
seam**; M24.B then extends the registry with the transport/navigation/annotation commands
rather than building it from scratch. This is the concrete reason undo is a prerequisite:
M24.B's "never fire in a text field" rule *is* the fix for the text-undo conflict, and it
cannot be bolted onto a history that the native menu drives.

## Lifecycle and exclusions

- **Dirty tracking** observes the same snapshot, so an undo marks the project dirty (as it
  does today) — but now through one signature, not two parallel ones.
- **Transient MCP edits** (`run_analysis(..., transient: true)`, a read-only `compare`)
  bypass the snapshot write, so they are not recorded as undo steps; a non-transient agent
  edit is recorded like a user edit (correct — the agent changed the project).
- **Comparisons stay out of undo/redo** (ADR-24/27); the saved `COMPARE` snapshots are
  project content and remain undoable as a unit.
- **History resets** on New / Open / source change and never crosses a project boundary.

## Scope: full unification, delivered in phases

The end-state is **one list, one place**: the core-owned snapshot is the authoritative
project content, and undo, dirty, and save all read it — the three parallel frontend
readers disappear. This milestone commits to **Option B** and delivers it in three phases,
each independently validatable, so the fiddly parts land last rather than all at once.

### Today's three readers (the drift is real)

| Reader | Shape | Notices |
| --- | --- | --- |
| `history.ts` (`Snapshot`) | filter/synth layout, `filterEnabled`, shared, toolOptions, window, layout, `openTools`, annotations, `selectedAnnotationId` | no source, no view, no compare |
| `dirty.ts` (`projectSignature`) | source name/frames, filter/synth spec, shared, toolOptions, window **+ view**, `filterEnabled`, `openTools`, compare signature, layout (sans viewport sizes), annotations | no selection |
| `snapshot.ts` | source **descriptor**, setup, layout (+ graph positions + popouts + `filterSpec`), results, compareOpen | the save shape |

They have already drifted (view, source, selection, and compare each appear in only one or
two of them). That drift is the bug class this work removes. Each phase below deletes one
reader and re-points its consumer at the snapshot.

### Phase 1 — the snapshot and the undo/redo feature

The core snapshot type becomes **authoritative**; undo/redo land on it.

- **In scope:** the core snapshot type (the single definition, from `project-file-format.md`'s
  sections); the coalesced frontend push (shared state, graphs, layout); the undo/redo stacks
  + reducer + reset + restore broadcast; the remote-apply mute flag; the registry seam
  (`undo` / `redo` + the text-field guard); removing the native undo/redo accelerators.
- **Deleted:** `history.ts`.
- **Still frontend for now:** `save` (`snapshot.ts`) and `dirty` (`dirty.ts`) — they are
  re-pointed in phases 2–3, not here.
- **Validated by:** the undo/redo e2e (edit → undo → redo; text-field native undo; empty
  stack on open; a popout edit undoable once; source change resets; transient MCP edits not
  recorded).

Phase 1 is the M24.B prerequisite: the registry seam and its text-field guard are what M24.B
builds on.

### Phase 2 — save and load read the snapshot

`snapshot.ts`'s assemblers and the `SaveProject` / `LoadedProjectDto` DTOs retire; the save
path serializes the snapshot the frontend has been pushing, and the load path returns it.

- **In scope:** `save_project` writes the core snapshot (plus the PCM the core already owns);
  `load_project` returns the snapshot as one projection; the headless / MCP / CLI save path
  produces the same snapshot shape, so GUI-pushed and headless-assembled converge on one
  definition.
- **Retired:** `snapshot.ts` as the save-side assembler (its read of the stores becomes the
  phase-1 push), the `SaveProject` DTO, and the scattered `LoadedProjectDto` assembly.
- **Touches:** `commands/project/{write,read}.rs` and the migration path (ADR-32 / M37:
  `upgradedFrom` forces dirty until a save writes the current version).
- **Validated by:** the existing save/load round-trip specs (H, N) and the headless-save /
  migration tests.

### Phase 3 — dirty moves to the core (the fiddly part)

`dirty.ts`'s logic relocates into the core, which broadcasts a `dirty` flag.

- **In scope:** the canonical key-order sort, the viewport-size stripping
  (`withoutViewportSizes` / `layoutSignature`), the compare signature, and the
  `SETTLE_MS` / `beginBaseline` / `endBaseline` machinery; `isEmptyProject` derived from the
  snapshot; `menu.ts`'s `confirmDiscard` and the title asterisk consume the broadcast `dirty`.
- **Deleted:** `dirty.ts`.
- **Validated by:** the unsaved-work specs (S), the close guard, and the "freshly loaded
  project is clean" regression (the settle behaviour that bit once before).

Phase 3 is the *only* place the frontend-tuned settle/baseline and viewport-strip behaviour
moves between languages — the highest-regression step, deliberately last.

### Why phased, not one cut

Each phase deletes one of the three readers and is shippable/testable on its own; the total
work is the same as one atomic migration, but the risk concentrates only in phase 3. Save
(phase 2) is nearly mechanical because `snapshot.ts` already assembles "the save shape";
dirty (phase 3) is the fiddly one because of the settle and viewport-size subtleties.

## Testing

- **Rust unit** (`cargo test` in `src-tauri/`): the snapshot reducer (commit/dedupe/cap,
  canonical key order, undo/redo stack semantics, reset boundaries), the key-boundary diff
  that computes what to broadcast, and the round-trip of the snapshot through `postcard` /
  `serde_json` (the "adding a field must not silently leave the snapshot" compile-time
  check plus a wire test).
- **Frontend unit** (`npm run test:unit`): the coalesced push's leading/trailing semantics
  and the remote-apply mute flag, extracted into a pure module as the other suites are.
- **E2E** (a new spec, or a section of an existing one): an edit is one undo step; undo
  restores it and redo re-applies it; a text field keeps native undo (typing then `Mod+Z`
  undoes text, not the project); a freshly opened project has an empty stack (no spurious
  step); an edit in a popout is undoable once from the project window and the restore
  reaches the popout; a source change resets the stack; transient MCP edits are not
  recorded.
- The existing `MenuAction` id test in `src-tauri/src/menu/mod.rs` is updated: `undo` /
  `redo` stop being menu actions (the ids move to the command registry).

## Files

| Path | Role |
| --- | --- |
| `src-tauri/src/state/` | the project-state snapshot type + undo/redo stacks + reducer |
| `src-tauri/src/commands/` | `undo` / `redo` / `can_undo` / `can_redo` / `reset_history`, the snapshot push, and the restore broadcast |
| `src-tauri/src/menu/build.rs` | remove the Undo/Redo accelerators (the menu stays for File/View/Window/Help) |
| `src/state/history.ts` | **deleted** — replaced by the core-owned history |
| `src/state/project/snapshot.ts` | the frontend projection that pushes project state to the core (reuses `currentDescriptor`/`currentSetup`/`currentLayout`) |
| `src/state/keybindings/` | the minimal registry skeleton + dispatcher guard; `undo`/`redo` are the first two commands |
| `src/state/project/{save,load}.ts`, `src-tauri/src/commands/project/{write,read}.rs` | save/load read and write the snapshot (phase 2) |
| `src/state/project/dirty.ts` | **deleted** (phase 3 — dirty moves to the core) |
| `docs/undo-redo.md`, `docs/decisions.md` | this plan + the ADR |

## Proposed ADR-37 — Undo/redo is a core-owned, revision-based project operation

**Context:** undo/redo shipped in M8.A as a frontend snapshot (`src/state/history.ts`),
before ADR-11's model (project UI state in the core; windows are views) was fully applied
to it. The result is a per-window stack over state the frontend does not own: it captures
remote `ui-state` patches as local edits (ping-pong), every peer edit wipes the redo
branch, a freshly loaded project acquires a spurious step, and the native menu accelerators
shadow text-field undo.

**Decision:** the **core owns the undo/redo history** — a bounded stack of project-state
snapshots per project, the same shape `save_project` persists. The frontend pushes
settled project-state changes (shared state, graphs, layout) to the core through a
coalesced channel; undo/redo are core commands that diff the target snapshot against the
current one and broadcast the changed keys over the existing `ui-state` protocol. `Mod+Z` /
`Shift+Mod+Z` become commands in the M24.B registry with a text-field guard, not native menu
accelerators.

**Consequence:** one writer, one stack, one snapshot — the local/remote ambiguity, the
redo-wipe, and the spurious fresh-load step disappear. Windows are pure projections that
apply restores with a mute flag. History resets on New / Open / source change. The snapshot
type is the single enforcement point for "what is undoable" (the project-file sections,
linked, not restated). The per-key whole-value patch is reused first; RFC 6902 within a key
is deferred. `save` and `dirty` are re-pointed at the same snapshot within this milestone
(phases 2–3), so undo, dirty, and save share one list.

**Status: proposed.**

## Decisions and status

1. **Milestone label — decided.** The existing M24 becomes **M24.B**; this reimplementation
   is **M24.A — Undo/redo as a core project operation**, delivered before M24.B.
2. **Scope — decided: full unification (Option B), phased.** One snapshot becomes the single
   source for undo, save, and dirty; delivered in three phases (snapshot + undo → save/load →
   dirty), each independently validatable. See "Scope: full unification".
3. **Dockview layout ownership — decided.** Layout + graph positions are pushed to the core,
   so layout edits are undoable (the one genuinely new push channel).
