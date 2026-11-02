import { createSignal } from "solid-js";
import type { AdjacentProjects } from "../../bindings/AdjacentProjects";
import { invoke } from "../../lib/ipc";
import { loadProject } from "./load";
import { projectPath, setProjectError } from "./signals";

/**
 * Step through the `.heyl` files in the current project's folder (M25.D).
 *
 * File → Previous/Next Project and the toolbar's `[<] name [>]` arrows use this: a batch
 * (an evaluation run, a set of recordings) produces many sibling projects, and moving
 * between them should not require a dialog each time. The order is the folder's file
 * names, case-insensitively; the ends stop rather than wrap. The caller confirms
 * unsaved work first.
 */

const NO_NEIGHBOURS: AdjacentProjects = { previous: null, next: null };

/** The current project's neighbours in its folder (`null` for an unsaved project). */
export const [adjacentProjects, setAdjacentProjects] =
  createSignal<AdjacentProjects>(NO_NEIGHBOURS);

/**
 * Re-read the current project's neighbours, for the toolbar's arrows (one folder read).
 * Called when the project path changes — a load, a save-as, or a step to a sibling.
 */
export async function refreshAdjacentProjects(path: string | null): Promise<void> {
  if (!path) {
    setAdjacentProjects(NO_NEIGHBOURS);
    return;
  }
  try {
    // `null` when the stub/older core does not answer: treat it as no neighbours.
    const neighbours = await invoke<AdjacentProjects | null>("adjacent_projects", { path });
    setAdjacentProjects({
      previous: neighbours?.previous ?? null,
      next: neighbours?.next ?? null,
    });
  } catch {
    // A folder that cannot be read simply offers no neighbours.
    setAdjacentProjects(NO_NEIGHBOURS);
  }
}
export async function openAdjacentProject(direction: -1 | 1): Promise<void> {
  const path = projectPath();
  if (!path) {
    setProjectError("Save this project before stepping to another project in the folder.");
    return;
  }

  let next: string | null;
  try {
    next = await invoke<string | null>("adjacent_project", { path, direction });
  } catch (err) {
    setProjectError(String(err));
    return;
  }
  if (!next) {
    setProjectError(
      direction < 0
        ? "This is the first project in the folder."
        : "This is the last project in the folder.",
    );
    return;
  }

  await loadProject(next);
}
