import type { SaveProjectRequest } from "../../bindings/SaveProjectRequest";
import type { SourceLinkCheck } from "../../bindings/SourceLinkCheck";
import { invoke } from "../../lib/ipc";
import { openPath, setWindowTitle, source } from "../source";
import { askBrokenLink, setSourceStorage, sourceStorage } from "../sourceStorage";
import { basename, projectLabel } from "./paths";
import { flushProjectPush } from "./push";
import { rememberRecent } from "./recents";
import {
  createdMs,
  projectPath,
  setProjectError,
  setProjectPath,
  setProjectStatus,
  setProjectTitle,
  setUpgradedFrom,
} from "./signals";
import { currentCompareOpen, currentResults, defaultFileName } from "./snapshot";
import { refreshDirty } from "./unsaved";

/**
 * Save the project file:
 * the core writes the project content it already holds — the same snapshot undo/redo
 * records — plus `META` and `DATA`. The request carries only what is **not** project
 * content: the creation time, the result cache and the open comparisons; *how* the
 * source is stored is project content (`SOURCE.storage`, `state/sourceStorage.ts`).
 */

/**
 * Make sure a linked source's file still resolves before the core writes the file.
 * Returns false when the user cancelled — the save then writes nothing, silently.
 */
async function linkResolves(): Promise<boolean> {
  if (source() == null || sourceStorage() === "embedded") return true;
  // The core answers `source_link_check` from the snapshot it holds, so push the current
  // descriptor (path + mode) first.
  await flushProjectPush();
  const check = await invoke<SourceLinkCheck>("source_link_check");
  if (check.exists) return true;
  const choice = await askBrokenLink("save", check.path);
  if (choice === "cancel") return false;
  if (choice === "embed") {
    // The audio in memory becomes the project's own: no file to resolve any more.
    setSourceStorage("embedded");
    await flushProjectPush();
    return true;
  }
  const picked = await invoke<string | null>("pick_audio_file");
  // Re-read the file the user pointed at; a failed open leaves nothing to save.
  if (picked == null || !(await openPath(picked, false, "linked"))) return false;
  // The save writes the snapshot the core holds, so hand it this re-read source first.
  await flushProjectPush();
  return true;
}

async function write(path: string): Promise<boolean> {
  setProjectStatus("saving");
  setProjectError(null);
  try {
    // Flush the coalesced push first: the core writes the snapshot it holds, so it must
    // be the state on screen rather than the one from the last settle.
    await flushProjectPush();
    if (!(await linkResolves())) return false;
    const request: SaveProjectRequest = {
      createdMs: createdMs(),
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
export async function saveProjectTo(path: string): Promise<boolean> {
  return write(path);
}
