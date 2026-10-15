import { invoke } from "../../lib/ipc";

/** Remember a project file in the native File → Open Recent menu. */
export function rememberRecent(path: string) {
  void invoke("add_recent_project", { path }).catch((err) =>
    console.error("could not update the recent projects", err),
  );
}
