import { invoke } from "../../lib/ipc";
import { listenThisWindow } from "../../lib/windowEvents";
import { dirty, setDirty } from "./signals";

/**
 * Unsaved work, as the core reports it (M24.A phase 3).
 *
 * The core owns the dirty flag: it compares the project snapshot this window pushes with
 * the last clean point and broadcasts `project-dirty` when the answer changes. The flag
 * drives the title `*` and the discard prompt;
 * `isEmptyProject` asks the core whether there is anything worth protecting at all.
 */

/** The `project-dirty` broadcast, as the core emits it. */
interface DirtyEvent {
  dirty: boolean;
}

/**
 * Follow the core's dirty flag. Call once per project window, after the shared state has
 * been pulled and the project-state push has started (so the core has a baseline).
 */
export async function initDirty(): Promise<void> {
  try {
    await listenThisWindow<DirtyEvent>("project-dirty", (event) => setDirty(event.payload.dirty));
    // A window opened mid-project starts from the project's current state.
    setDirty(await invoke<boolean>("is_dirty"));
  } catch (err) {
    console.error("could not follow the unsaved-work flag", err);
  }
}

/**
 * Whether the project has nothing worth protecting: no source, no annotations, and both
 * graphs still in their seeded shape. A failed query answers `false`, so a discard prompt
 * is shown rather than skipped.
 */
export async function isEmptyProject(): Promise<boolean> {
  return invoke<boolean>("is_empty_project").catch(() => false);
}

/**
 * Pull the flag the core now holds into the signal. The broadcast is asynchronous, so an
 * action whose result the user (or an MCP caller) inspects immediately — a save reporting
 * `dirty` — reads it back instead of waiting for the event.
 */
export async function refreshDirty(): Promise<void> {
  setDirty(await invoke<boolean>("is_dirty").catch(() => dirty()));
}
