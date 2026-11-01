import { invoke } from "../../lib/ipc";
import { loadProject } from "./load";
import { projectPath, setProjectError } from "./signals";

/**
 * Step through the `.heyl` files in the current project's folder (M25.D).
 *
 * File → Previous/Next Project uses this: a batch (an evaluation run, a set of
 * recordings) produces many sibling projects, and moving between them should not
 * require a dialog each time. The order is the folder's file names, case-insensitively;
 * the ends stop rather than wrap. The caller confirms unsaved work first.
 */
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
