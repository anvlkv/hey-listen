import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  loadProject,
  newProject,
  openProject,
  projectPath,
  saveProject,
  saveProjectAs,
} from "./project";

/**
 * Native menu + OS file-open wiring (M6).
 *
 * The Rust menu (`src-tauri/src/menu.rs`) emits `app:menu` with a File action id;
 * file associations deliver `.heyl` paths through `app:open-project` (a running app)
 * or `take_pending_open_paths` (a request that arrived before the frontend listened,
 * e.g. launching by double-clicking a project). See `docs/ui-layout.md`.
 */

/** Paths already handled, so a launch request is not loaded twice. */
const handled = new Set<string>();

async function openPaths(paths: string[]) {
  for (const path of paths) {
    if (handled.has(path) || path === projectPath()) continue;
    handled.add(path);
    await loadProject(path);
  }
}

/** Subscribe to native menu actions and OS file-open requests. */
export async function initMenu() {
  try {
    await listen<string>("app:menu", (event) => {
      switch (event.payload) {
        case "new":
          void newProject();
          break;
        case "open":
          void openProject();
          break;
        case "save":
          void saveProject();
          break;
        case "saveAs":
          void saveProjectAs();
          break;
      }
    });

    await listen<string[]>("app:open-project", (event) => {
      void openPaths(event.payload);
    });

    // Files requested before this listener existed (command line / macOS open event).
    await openPaths(await invoke<string[]>("take_pending_open_paths"));
  } catch (err) {
    console.error("could not initialise the app menu", err);
  }
}
