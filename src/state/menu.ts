import { invoke } from "../lib/ipc";
import { listenThisWindow } from "../lib/windowEvents";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";
import { redo, undo } from "./history";
import { openPath } from "./source";
import {
  dirty,
  isProjectFile,
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
 * file associations deliver `.heyl` (and audio) paths through `app:open-project`
 * (a running app) or `take_pending_open_paths` (a request that arrived before the
 * frontend listened, e.g. launching by double-clicking a project). A `.heyl` path
 * loads that project; any other supported audio path opens as a new project with
 * the file as its source. See `docs/ui-layout.md`.
 */

/** Paths already handled, so a launch request is not loaded twice. */
const handled = new Set<string>();

/**
 * Whether the in-app **About** dialog is open. Opened from the Toolbar's
 * `circle-question` button and from the native Help → About menu item (which emits
 * the `about` action on `app:menu`); rendered by `App`.
 */
export const [aboutOpen, setAboutOpen] = createSignal(false);

/**
 * Confirm discarding unsaved work before replacing the project; `true` when it is
 * safe to proceed (nothing is dirty, or the user chose to discard).
 */
async function confirmDiscard(): Promise<boolean> {
  if (!dirty()) return true;
  return invoke<boolean>("confirm", {
    message: "You have unsaved changes. Discard them?",
    title: "Discard changes?",
  });
}

/** Run a project-replacing action, first confirming any unsaved work. */
async function guarded(action: () => Promise<void>): Promise<void> {
  if (await confirmDiscard()) await action();
}

async function openPaths(paths: string[]) {
  const pending = paths.filter((path) => !handled.has(path) && path !== projectPath());
  if (pending.length === 0) return;
  if (!(await confirmDiscard())) return;
  for (const path of pending) {
    handled.add(path);
    if (isProjectFile(path)) {
      await loadProject(path);
    } else {
      // A supported audio file opens as a fresh project with it as the source.
      await newProject();
      await openPath(path);
    }
  }
}

/** Subscribe to native menu actions and OS file-open requests. */
export async function initMenu() {
  try {
    await listenThisWindow<string>("app:menu", (event) => {
      switch (event.payload) {
        case "new":
          void guarded(newProject);
          break;
        case "newWindow":
          // A new window is an independent project (one window = one project); the
          // current window is untouched, so no unsaved-work guard is needed.
          void invoke("open_project_window").catch((err) =>
            console.error("could not open a new window", err),
          );
          break;
        case "open":
          void guarded(openProject);
          break;
        case "save":
          void saveProject();
          break;
        case "saveAs":
          void saveProjectAs();
          break;
        case "undo":
          undo();
          break;
        case "redo":
          redo();
          break;
        case "about":
          setAboutOpen(true);
          break;
      }
    });

    // Warn before closing the window while there is unsaved work. The close is always
    // routed through `close_window` (Rust): the JS `onCloseRequested` helper would
    // otherwise call `destroy()` itself, which needs a window permission we do not hold.
    await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (dirty() && !(await confirmDiscard())) return;
      void invoke("close_window").catch(() => {});
    });

    await listenThisWindow<string[]>("app:open-project", (event) => {
      void openPaths(event.payload);
    });

    // Files requested before this listener existed (command line / macOS open event).
    await openPaths(await invoke<string[]>("take_pending_open_paths"));
  } catch (err) {
    console.error("could not initialise the app menu", err);
  }
}
