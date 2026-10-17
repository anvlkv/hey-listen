/**
 * Project file store (M6): save/load the binary project (see
 * [`project-file-format.md`](../../docs/project-file-format.md)).
 *
 * The Rust core owns the `DATA` section (the source PCM, ADR-9) and fills in `META`;
 * the frontend supplies `SOURCE` (a descriptor), `SETUP` (shared params, per-tool
 * options, open tools, windows), and `LAYOUT` (dockview + graph editor state). On
 * load the core streams the audio back for the Timeline waveform and installs the
 * PCM for preview/analysis; this module restores the stores and the Workbench tabs,
 * so the analyzers re-derive their results from the embedded audio.
 *
 * This entry point re-exports the names importers use, so they need no changes. The
 * parts live in focused siblings: `types` (the section DTOs), `paths` (the `.heyl`
 * extension + path helpers), `signals` (identity/status/dirty signals + the project
 * name), `snapshot` (reads the stores for a save), `save`, `load`/`open`,
 * `newProject`, `recents` (Open Recent), and `dirty` + `title` (the reactive
 * effects, installed below).
 *
 * Only the names a consumer imports are surfaced here; the section DTOs stay
 * available from `./types`, the signal setters from `./signals`, and the path
 * helpers from `./paths`.
 */

// `dirty` and `title` install reactive effects as a side effect of evaluation — import
// them (in this order) so unsaved-work tracking and the window-title sync start
// exactly as they did before.
import "./dirty";
import "./title";

export { isEmptyProject } from "./dirty";
export { isProjectFile } from "./paths";
export {
  applyProjectTitle,
  dirty,
  projectDisplayName,
  projectError,
  projectName,
  projectPath,
  projectStatus,
} from "./signals";
export { saveProject, saveProjectAs, saveProjectTo } from "./save";
export { loadProject, openProject } from "./load";
export { newProject } from "./newProject";
