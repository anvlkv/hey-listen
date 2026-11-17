# Logging

**Status:** planned. Deliberately **not** a milestone — `roadmap.md` stays as it is until
this is scheduled; treat this doc as the design of record once it is.

One log file should hold what **both** sides of the app say. The Rust core already writes
one (`tauri-plugin-log`); this plan completes the other half (the webview), makes a failure
on either side land in it, and puts the file one Help-menu click away.

## Goals

1. **One log.** A backend line and a frontend line go to the same file, in order, with the
   origin visible in the line.
2. **Open the log location** from the Help menu.
3. **Preview the log** from the Help menu, without leaving the app.
4. **Errors are logged on both sides** — including the ones no `console` ever sees (a Rust
   panic) and the ones only the frontend sees (a rejected command, an unhandled rejection).
5. **A dedicated log destination for E2E**, so a CI artifact carries the app's own log
   instead of leaving it in the runner's home directory.

## Current state

### Backend — working

`lib.rs` registers `tauri-plugin-log` with `log_targets` (`src-tauri/src/lib.rs`):

| Target | When | Where |
| --- | --- | --- |
| `TargetKind::Stderr` | always | the process's stderr |
| `TargetKind::LogDir { file_name: "hey-listen" }` | a GUI launch only | the OS log dir (`app_log_dir()`; on macOS `~/Library/Logs/com.anvlkv.heylisten/hey-listen.log`) |

The file starts fresh each launch (`FileOpenStrategy::Rotate`), rotates at 2 MB
(`max_file_size`), and keeps 3 archived files (`hey-listen_<date>.log`). Level is
`LevelFilter::Info`. A CLI invocation (`--mcp` / `--headless`) gets **stderr only** on
purpose (a sandboxed or concurrent run must not abort over a log path); the batch binary
`hey-listen-cli` has no log plugin at all (ADR-29). fern flushes once per record, so a tail
of the file is live.

### Frontend — partial

`@tauri-apps/plugin-log` is registered (`log:default` in
`src-tauri/capabilities/default.json`), but only two call sites use it:

- `src/boot.ts` → `reportStartupFailure` sends the startup failures explicitly.
- `src/index.tsx` → `void attachConsole()`.

`attachConsole()` mirrors **Rust → webview console**. It is the wrong direction for goal 1,
and — because the builder sets no `TargetKind::Webview` — it currently receives **nothing at
all**: the plugin only emits `log://log` to a webview target. So `console.*` is *not* in the
log file, and Rust lines are *not* in the webview console either. `docs/architecture.md` →
"Plugins" states the opposite (that `attachConsole` puts `console.*` in the log); that
sentence is wrong and this plan corrects it.

### Errors

| Origin | Today |
| --- | --- |
| Uncaught error / unhandled rejection | `src/boot.ts` handlers → webview console **and** the log file ✅ |
| `console.error` anywhere else (`src/state/**`, ~30 call sites) | webview console only ❌ |
| A rejected `invoke` (the command layer's `Result::Err`) | the caller's `console.error`, i.e. console only ❌ |
| A Rust `log::error!` / `log::warn!` (`audio/playback/stream.rs`, `commands/playback.rs`, …) | file ✅ |
| A **Rust panic** | stderr only (`panic = "abort"` in release: never the file) ❌ |
| A command error swallowed in Rust (`let _ = …`) | nowhere ❌ |

### E2E

The suite drives the release binary; the app's own log goes to the runner's OS log dir (a
developer's home), and `e2e/artifacts/` holds only the service log, the per-spec JSON and
the failure screenshots. A failed CI run therefore has no app log.

> The repo-root `logs/` directory is **scratch from manual runs** (redirected
> `npm run tauri dev` / `wdio` output), not something the app writes. It is gitignored and
> is not the E2E destination below.

## Design

### 1. One sink, two producers

`log_targets` gains the **webview** target and an env var that **relocates the file** target:

```text
stderr                                   (always)
LogDir { file_name: "hey-listen" }       (GUI, HEYLISTEN_LOG_DIR unset)
Folder { path: HEYLISTEN_LOG_DIR, … }    (GUI, HEYLISTEN_LOG_DIR set — the E2E case)
Webview                                  (GUI: the devtools mirror)
```

There is **one** file for both producers — splitting it by target would break goal 1.
The origin is already in the plugin's default format, because a frontend record carries the
target `webview`:

```text
[2026-11-17][20:05:11][hey_listen_lib][INFO] hey-listen 0.7.0 starting
[2026-11-17][20:05:12][webview][ERROR] [ui src/state/project/load.ts:189] could not restore…
```

`HEYLISTEN_LOG_LEVEL` (`trace` … `error`, default `info`) overrides the filter, so a bug
report can be taken at `debug` without a rebuild.

### 2. The frontend bridge — `src/lib/log.ts`

One module, imported **first** (from `src/boot.ts`, which is already the first import in
`src/index.tsx`), installs:

1. **A `console` patch.** `console.trace/debug/log/info/warn/error` are wrapped once; each
   call forwards to the plugin after calling the original (devtools output is unchanged).
   The level map is the obvious one (`log`/`info` → info, `debug` → debug, …).
2. **An origin prefix.** `getCallerLocation` in the plugin would name the wrapper, so the
   wrapper computes a short `file:line` from `new Error().stack` (skipping its own frames)
   and prefixes the message `[ui <file>:<line>]`. It then calls
   `invoke("plugin:log|log", { level, message })` **without** a location, so the target stays
   the plain `webview` and the line stays short.
3. **A loop guard.** The plugin's `Webview` target re-emits every record on `log://log`; a
   naive bridge would forward the mirror of its own write forever. `initLogMirror()` replaces
   `attachConsole()` with `attachLogger(...)` inside the same module, **only when
   `import.meta.env.DEV`** (a released build has no devtools to read it), and sets a
   `mirroring` flag around the console call: a mirrored Rust line is printed to the console
   and never forwarded. The flag is safe because the mirror callback and the console call
   are synchronous.
4. **Guards.** Forwarding never throws (`.catch(() => {})`), never calls the *patched*
   console on failure (that would recurse), caps a single message at ~8 KB, and is skipped
   entirely in the Lighthouse preview (`window.__HEYLISTEN_PREVIEW__`, which has no core to
   invoke). Object arguments are formatted (Error → name + message + stack, values →
   `JSON.stringify` with a circular guard).

`src/lib/log.ts` deliberately uses `@tauri-apps/api/core`'s `invoke` **directly**, not
`src/lib/ipc.ts`: logging must not pass through the E2E mock seam, and `ipc.ts` itself logs
(§3), so going through it would recurse.

`src/boot.ts` keeps its `error` / `unhandledrejection` handlers and drops its own
`logError` call — `console.error` now reaches the file through the bridge. `src/index.tsx`
drops `attachConsole()` for `initLogMirror()`.

### 3. Errors from both sides

The rule is: **log the failure where it is finally known**.

| Origin | Change |
| --- | --- |
| `console.error` / `console.warn` (any module) | reaches the file through the bridge — no call-site changes |
| Uncaught error / unhandled rejection | unchanged (`src/boot.ts`) |
| A rejected `invoke` | `src/lib/ipc.ts` reports `[ipc] <cmd> failed: <message>` through `console.error`, so the bridge adds the origin and the line lands in the file; every command is covered without touching one |
| A Rust command that **returns** `Err` | not logged in Rust: the façade line above already carries the message, and logging it twice doubles every expected failure (a corrupt probe is a UI state, not a defect) |
| A Rust command that **swallows** an error | audit `let _ = …` / `unwrap_or_default()` in `commands/` and log at `warn!`/`error!` where the user-visible effect is a silent no-op (the existing `results.rs`, `themes.rs`, `cli_install.rs`, `playback.rs` sites are the pattern) |
| A Rust **panic** | `logging::guard_panics()` installs `std::panic::set_hook`: `log::error!` the message + location, then call the previous hook so stderr keeps the standard report. GUI launches only (a CLI invocation already prints to stderr) |

### 4. Help menu — two actions

`menu.rs` gains `MenuAction::{OpenLogFolder, ShowLog}` (wire ids `openLogFolder` /
`showLog`, as the enum's `serialize_all` dictates; the `action_ids_match_the_frontend` test
extends with them) and two Help items, before *Check for Updates…*: **Show Log…** then
**Open Log Folder**. `ui-layout.md`'s menu list takes them over once they exist.

Unlike About / Check for Updates / Install CLI (which are emitted on `app:menu` because the
frontend owns the dialog), these two need no webview at all: the core can raise the window
and open the folder itself, so `on_menu_event` handles them before the generic emit — the
same shape as the Open Recent items. No round trip also means the action cannot be lost
while a window is still booting, and the log preview does not have to be a project window
for its own menu item to work.

### 5. The log preview — a **popout window**

A Workbench tab is out: ADR-10 fixes the tab set to the graph editors plus the analyzer
tabs, and `ui-layout.md` fixes the regions. So the preview reuses the **popout** machinery
(ADR-11) instead of inventing a window role — label `popout-N` from `next_label`, the same
`index.html`, and a fourth answer to the "which view am I?" query. That is also the cheapest
option in reach: `popout-*` is already in `capabilities/default.json`, and everything that
already ignores popouts — `focused_label`, `list_projects` / `target_label` (MCP),
`compare_targets`, `project_window_showing`, `sync_popouts` — keeps ignoring this one with
no change, because `popout_tool` / `popout_annotation` stay `None` for it.

- **Opening.** Help → Show Log… → `open_log_window` (called from `menu.rs`), which raises a
  log popout that is already open anywhere and otherwise builds one aliased to the focused
  project window; it returns the label, which is what the E2E switches to. Singleton: one
  log window per app, not one per project.
- **Registry.** `add_log_popout(label, parent)` writes the alias **and** a marker set (like
  `popout_compares`), so `is_popout` / `root_label` hold while the tool and annotation maps
  do not — which is what keeps `sync_popouts`, the save path and `popout_tools_of` blind to
  it. `popout_log` answers the window's query, beside `popout_tool` / `popout_annotation`.
- **It is a view of the project it was opened from** (ADR-11), so it closes with that
  window; the *content* is application-wide. `close_popouts` (the project-load path) must
  skip it: a load replaces the old project's **views**, and the log is not one — otherwise
  every File → Open would close the preview.
- **Content** (`src/LogApp.tsx` + `src/components/log/LogView.tsx`): a monospace list, no
  wrap, a level floor, a text filter, **Follow** (auto-scroll), **Copy**, **Open Log
  Folder**. It starts no project state and asks for no shared source. Test ids `log.window`,
  `log.list`, `log.filter`, `log.follow`, `log.reveal`.
- **`src/index.tsx`** adds `popout_log` to the `Promise.all` in `popoutTarget()` and a
  `{ kind: "log" }` branch to `PopoutTarget`; `PopoutApp` is untouched.
- It polls `read_log_tail` about once a second while the window is visible — simpler than
  matching the `log://log` stream to the file (no gap and no duplicate between the initial
  read and the live append). Each read is bounded by bytes and the file is capped at 2 MB
  before it rotates, so a poll stays cheap; a rotation mid-poll only means the next read is
  the new file's tail.
- **Commands** (`commands/log.rs`, plus `popout_log` / `open_log_window` beside the other
  popout commands): `log_path` → `{ dir, file }` (the *active* destination, so it reports
  the E2E dir when that is in force), `read_log_tail` → `{ lines, truncated }` reading only
  the known file (never an arbitrary path), `open_log_dir`. `open_log_dir` shares one
  `open_in_file_manager` helper, lifted out of `themes.rs` (no copied platform match).

### 6. A log destination for E2E

- Rust: `HEYLISTEN_LOG_DIR` (read once in `log_targets`) becomes `TargetKind::Folder`.
- `wdio.conf.ts`: the service's `env` is merged over `process.env` when it spawns the app,
  so `env: { HEYLISTEN_LOG_DIR: E2E_LOG_DIR, HEYLISTEN_LOG_LEVEL: "info" }` is all it takes.
  `e2e/support/logs.ts` owns `E2E_LOG_DIR` (`e2e/artifacts/logs`) and `appLogPath()`;
  `wdio.conf.ts` imports it rather than spelling the path a second time, and `onPrepare`
  clears the folder with the rest of the run's artifacts.
- `docs/testing.md` → "Artifacts" and the `outputDir` comment list the new folder.

## Decisions

- **D1 — the preview is a popout window.** A Workbench tab would need an ADR-10 amendment
  and new tab chrome; a modal dialog would block the interaction that produces the log. The
  popout needs no new window role (only a marker in the registry), so nothing that lists
  projects learns a new kind. Record D1 as ADR-33 in `decisions.md` when the work is
  scheduled.
- **D2 — poll the file, do not stream events, in the preview.** `log://log` is broadcast to
  every window and would have to be reconciled with the history already on disk.
- **D3 — one file for both producers.** Separating `hey-listen.log` / `webview.log` (which
  the plugin supports with per-target filters) would make a bug report two attachments.
- **D4 — no new dependencies.** `tauri-plugin-log` already provides the webview target,
  the folder target and the shell-side API.

## Work breakdown

| File | Change |
| --- | --- |
| `src-tauri/src/logging.rs` *(new)* | `targets()`, `level()`, `log_dir()`, `log_file()`, `guard_panics()`, `open_dir()` + the shared `open_in_file_manager` (moved from `themes.rs`) |
| `src-tauri/src/lib.rs` | `log_targets` → `logging::targets`; install `guard_panics`; register the new commands |
| `src-tauri/src/menu.rs` | the two `MenuAction` variants, the Help items, native handling, wire test |
| `src-tauri/src/commands/log.rs` *(new)* | `log_path`, `read_log_tail`, `open_log_dir` |
| `src-tauri/src/commands/window.rs` | `open_log_window` + `popout_log` beside the tool/annotation popout commands; `close_popouts` skips the log view |
| `src-tauri/src/state/window/mod.rs` | `add_log_popout` / `popout_log` + the marker set (cleared in `remove`) |
| `src/lib/log.ts` *(new)* | console patch, origin prefix, mirror, guards |
| `src/boot.ts` | import the bridge first; keep the `error` / `unhandledrejection` handlers |
| `src/lib/ipc.ts` | log a rejected invoke once |
| `src/index.tsx` | `initLogMirror()`; the fourth popout query and the `{ kind: "log" }` route |
| `src/LogApp.tsx`, `src/components/log/LogView.tsx` *(new)* | the preview window's content |
| `src/styles/*.css` | the log list (shared rules go to `src/styles/shared.css`) |
| `e2e/support/logs.ts` *(new)*, `wdio.conf.ts` | `E2E_LOG_DIR`, the service `env`, `onPrepare` cleanup |
| `e2e/support/selectors.ts`, `e2e/specs/i-errors.spec.ts` | the `log.*` ids; a case that logs a frontend error, opens the preview with `open_log_window`, checks the line in both the file and the window, and closes it |
| `docs/{README,architecture,ui-layout,testing}.md` | index row; the corrected plugin paragraph; the two Help items; the log artifact |

## Validation

- `npm run typecheck`, `npm run build`
- `cargo check` / `cargo test` in `src-tauri/` (the menu wire test; a unit test for
  `read_log_tail`'s byte cap and for `HEYLISTEN_LOG_DIR` in `targets`)
- `npm run maid` (file budget, no clones — the `open_in_file_manager` platform match is
  **moved** out of `themes.rs`, not copied beside it)
- `npm run test:e2e` — the new case: log a frontend error, assert it is in
  `e2e/artifacts/logs/hey-listen.log` and in the preview window
- By hand: a GUI launch at `HEYLISTEN_LOG_LEVEL=debug`, Help → Show Log…, trigger a failing
  open, confirm the line appears within a second and Help → Open Log Folder opens the same
  directory `log_path` reports

## Non-goals

- Previous sessions in the preview (rotation archives) — the file is per launch.
- Shipping logs off the machine (no telemetry).
- Logging in `hey-listen-cli` / `heylisten-mcp` beyond stderr (ADR-29).
- A structured (JSON) file format; the line format is the plugin's.

## Open questions

- Should the level filter be per target (quiet `webview` chatter, verbose `hey_listen_*`)?
  The plugin can do it; leave it until the volume is a problem.
- Should the preview be app-wide (survive its project window)? As a popout it is a view of
  the project it was opened from, so it closes with it; a project window is always open when
  the preview is opened, so this is only felt when that window closes.
