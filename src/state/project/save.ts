import { deepClone } from "../../lib/clone";
import { invoke } from "../../lib/ipc";
import { notes } from "../notes";
import { setWindowTitle } from "../source";
import { markClean } from "./dirty";
import { basename, projectLabel } from "./paths";
import { rememberRecent } from "./recents";
import {
  createdMs,
  projectPath,
  setProjectError,
  setProjectPath,
  setProjectStatus,
  setProjectTitle,
} from "./signals";
import { currentDescriptor, currentLayout, currentSetup, defaultFileName } from "./snapshot";
import type { SaveProjectArgs } from "./types";

/**
 * Save the project file (see [`project-file-format.md`](../../../docs/project-file-format.md)):
 * the frontend supplies `SOURCE`/`SETUP`/`LAYOUT` and the core fills in `META` + `DATA`.
 */

async function write(path: string): Promise<boolean> {
  setProjectStatus("saving");
  setProjectError(null);
  try {
    const args: SaveProjectArgs = {
      name: projectLabel(path),
      createdMs: createdMs() ?? undefined,
      source: currentDescriptor(),
      setup: currentSetup(),
      layout: await currentLayout(),
      notes: deepClone(notes()),
    };
    await invoke("save_project", { path, project: args });
    setProjectPath(path);
    setProjectTitle(projectLabel(path));
    void setWindowTitle(basename(path));
    rememberRecent(path);
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
export async function saveProjectTo(path: string): Promise<boolean> {
  return write(path);
}
