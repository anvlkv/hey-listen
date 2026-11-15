import { deepClone } from "../../lib/clone";
import { invoke } from "../../lib/ipc";
import { annotations } from "../annotations";
import { setWindowTitle } from "../source";
import { markClean } from "./dirty";
import { basename, projectLabel } from "./paths";
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
import {
  currentDescriptor,
  currentLayout,
  currentResults,
  currentSetup,
  defaultFileName,
  currentCompareOpen,
} from "./snapshot";
import type { SaveProjectArgs } from "./types";

/**
 * Save the project file (see [`project-file-format.md`](../../../docs/project-file-format.md)):
 * the frontend supplies `SOURCE`/`SETUP`/`LAYOUT` and the core fills in `META` + `DATA`.
 *
 * `embedSource` defaults to the project's own state: a project loaded as a **reference**
 * stays one, so re-saving it does not silently embed the whole recording.
 */

async function write(path: string, embedSource = !referenceProject()): Promise<boolean> {
  setProjectStatus("saving");
  setProjectError(null);
  try {
    const args: SaveProjectArgs = {
      name: projectLabel(path),
      createdMs: createdMs() ?? undefined,
      source: currentDescriptor(),
      setup: currentSetup(),
      layout: await currentLayout(),
      annotations: deepClone(annotations()),
      // The cached analyzer results, so the file restores them instead of re-running.
      results: currentResults(),
      embedSource,
      // The core writes the saved snapshot of each comparison open at save time (M25.C).
      compareOpen: await currentCompareOpen(),
    };
    await invoke("save_project", { path, project: args });
    setProjectPath(path);
    setProjectTitle(projectLabel(path));
    void setWindowTitle(basename(path));
    rememberRecent(path);
    // The file now holds the current format version and the audio the save was asked for.
    setUpgradedFrom(null);
    setReferenceProject(!embedSource && currentDescriptor()?.kind === "file");
    markClean();
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
