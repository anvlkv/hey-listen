import { closeAllTabs, mockReturn, restoreMocks, waitForApp } from "./helpers.ts";
import { closeWindowsMatching } from "./windows.ts";

/**
 * Register the session hygiene the project-file and annotation specs share: a fresh
 * app with no tabs, the core `confirm` prompt stubbed, a return to the `main` window
 * after each case, and removal of the temporary windows a case may have opened.
 *
 * Call inside a `describe` (it registers the hooks there). `temporaryWindow` is the
 * label pattern a case may open — popouts in `j-project`, annotation windows in `n-annotations`.
 */
export function projectSessionHooks(temporaryWindow: RegExp): void {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // Replacing a source / discarding unsaved work asks the core to confirm.
    await mockReturn("confirm", true);
  });

  afterEach(async () => {
    // A case may close the window it was driving, which pins the session to a dead
    // label; recover before touching the IPC seam.
    await browser.tauri.switchWindow("main").catch(() => {});
    await restoreMocks();
    await mockReturn("confirm", true);
  });

  after(async () => {
    // Close any window a case opened, then land back on the project window for the
    // specs that follow.
    await closeWindowsMatching(temporaryWindow);
    await browser.tauri.switchWindow("main").catch(() => {});
  });
}
