import type { SaveProjectRequest } from "../../bindings/SaveProjectRequest";
import { invoke } from "../../lib/ipc";
import { setWindowTitle } from "../source";
import { basename, projectLabel } from "./paths";
import { flushProjectPush } from "./push";
import { rememberRecent } from "./recents";
import {
  createdMs,
  projectPath,
  referenceProject,
  setProjectError,
  setProjectPath,
  setProjectStatus,
  setProjectTitle,
  setReferenceProject,
  setUpgradedFrom,
} from "./signals";
import { currentCompareOpen, currentDescriptor, currentResults, defaultFileName } from "./snapshot";
import { refreshDirty } from "./unsaved";

/**
 * Save the project file:
 * the core writes the project content it already holds — the same snapshot undo/redo
 * records — plus `META` and `DATA`. The request carries only what is **not** project
 * content: the creation time, the embedding choice, the result cache and the open
 * comparisons.
 *
 * `embedSource` defaults to the project's own state: a project loaded as a **reference**
 * stays one, so re-saving it does not silently embed the whole recording.
 */

async function write(path: string, embedSource = !referenceProject()): Promise<boolean> {
  setProjectStatus("saving");
  setProjectError(null);
  try {
    // Flush the coalesced push first: the core writes the snapshot it holds, so it must
    // be the state on screen rather than the one from the last settle.
    await flushProjectPush();
    const request: SaveProjectRequest = {
      createdMs: createdMs(),
      embedSource,
      // The cached analyzer results, so the file restores them instead of re-running.
      results: currentResults(),
      // The core writes the saved snapshot of each comparison open at save time (M25.C).
      compareOpen: await currentCompareOpen(),
    };
    await invoke("save_project", { path, request });
    setProjectPath(path);
    setProjectTitle(projectLabel(path));
    void setWindowTitle(basename(path));
    rememberRecent(path);
    // The file now holds the current format version and the audio the save was asked for.
    // The core clears its migration marker when the write succeeds (`load_project` sets
    // it); this signal is the notice's display.
    setUpgradedFrom(null);
    setReferenceProject(!embedSource && currentDescriptor()?.kind === "file");
    // The core takes its clean point from the snapshot it holds, so flush the state this
    // save just renamed (the push is coalesced) before re-baselining it.
    await flushProjectPush();
    await invoke("mark_project_clean").catch((err) =>
      console.error("could not mark the project clean", err),
    );
    // The broadcast is asynchronous; read the flag back so a caller that inspects it right
    // after a save (MCP `save_project`) sees the saved state.
    await refreshDirty();
    return true;
  } catch (err) {
    setProjectError(String(err));
    return false;
  } finally {
    setProjectStatus("idle");
  }
}

async function pickSavePath(): Promise<string | null> {
  try {
    return await invoke<string | null>("pick_project_save_path", {
      defaultName: defaultFileName(),
    });
  } catch (err) {
    setProjectError(String(err));
    return null;
  }
}

/** Save to the current path, prompting for one if the project has never been saved. */
export async function saveProject(): Promise<void> {
  const existing = projectPath();
  const path = existing ?? (await pickSavePath());
  if (path) await write(path);
}

/** Always prompt for a path, then save. */
export async function saveProjectAs(): Promise<void> {
  const path = await pickSavePath();
  if (path) await write(path);
}

/** Save to a specific path without a dialog (used by the MCP server). */
export async function saveProjectTo(path: string, embedSource = true): Promise<boolean> {
  return write(path, embedSource);
}
