/**
 /*
 * Tauri window helpers for the multi-window specs (M7+): opening a second project
 * window, listing a session's windows, closing the focused one, and cleaning up the
 * popout windows a spec leaves behind.
 *
 * A spec file gets one app session, so a spec that pops a window out owns closing it —
 * see `docs/testing.md` → E2E testing.
 */
import { waitFor } from "./dom.ts";
import { invokeCore } from "./ipc.ts";

/**
 * Open a new, independent project window (File → New Window) and return its label.
 *
 * Driven through the command rather than the `newWindow` menu action: the suite's
 * `menuAction` emits on the app's event channel with `event.emit`, which Tauri delivers to
 * **all targets** — with two project windows open, one `newWindow` emit would open a
 * window per project. The real menu scopes the action to the focused window
 * (`src-tauri/src/menu.rs`), so the command is the faithful equivalent here.
 *
 * The label is a process-global `project-<n>`; the new window shows up in `listWindows()`
 * before its webview boots, so callers must `waitForShell()` after switching to it.
 */
export async function openProjectWindow(): Promise<string> {
  const before = new Set(await windowLabels());
  await invokeCore("open_project_window");

  let label = "";
  await waitFor(async () => {
    label = (await windowLabels()).find((l) => /^project-\d+$/.test(l) && !before.has(l)) ?? "";
    return label !== "";
  }, "no project-* window appeared");
  return label;
}

/**
 * Close the window the test is currently focused on.
 *
 * It runs the app's own `close_window` command (`window.destroy()`), which tears the
 * caller down — the frontend's `onCloseRequested` guard prevents a *native* close and
 * routes it through this command, so going through it is the supported path.
 *
 * The close is **scheduled**, not awaited: `destroy()` can kill the webview before the
 * WebDriver script's reply is delivered, which timed out the call (and left the session
 * pinned to a dead window) on Windows. Returning from the script first and destroying a
 * beat later makes the close observable through [`windowLabels`] instead of a race.
 */
export async function closeCurrentWindow(): Promise<void> {
  await browser.tauri.execute((tauri) => {
    setTimeout(() => {
      void tauri.core.invoke("close_window").catch(() => {});
    }, 250);
  });
}

/**
 * The labels of every open Tauri window, via the plugin's `listWindows()`.
 *
 * Its shape is not relied upon: handles may be plain strings or objects carrying a
 * `label`/`handle`.
 */
async function listWindowsViaTauri(): Promise<string[]> {
  const windows = (await browser.tauri.listWindows()) as unknown;
  if (!Array.isArray(windows)) return [];
  return windows.map((w) => {
    if (typeof w === "string") return w;
    const obj = w as { label?: string; handle?: string; name?: string };
    return obj.label ?? obj.handle ?? obj.name ?? "";
  });
}

/**
 * The labels of every open Tauri window.
 *
 * Falls back to plain WebDriver window handles when the Tauri path rejects. The service
 * pins every `tauri.execute` to the window the session last switched to (it forwards that
 * label on each call), so once a spec **closes the window it is sitting in**, `listWindows()`
 * rejects until the session is pointed at a live label — and so does everything else on
 * that path. Window handles do not go through it, and for the embedded provider the handle
 * *is* the label. (`browser.tauri.switchWindow` recovers on its own: it validates via
 * `listWindows()`, and on a validation failure that is not a missing-label error it still
 * performs the switch.)
 */
export async function windowLabels(): Promise<string[]> {
  return listWindowsViaTauri().catch(() => browser.getWindowHandles());
}

/**
 * Close every window whose label matches `pattern`, then wait for it to be gone.
 *
 * Used by a spec's `after` hook so the next session (and the next spec file) starts on
 * a single project window rather than on a popout, which renders no Workbench.
 */
export async function closeWindowsMatching(pattern: RegExp): Promise<void> {
  for (const label of await windowLabels()) {
    if (!pattern.test(label)) continue;
    await browser.tauri.switchWindow(label).catch(() => {});
    await closeCurrentWindow().catch(() => {});
    await browser
      .waitUntil(async () => !(await windowLabels()).includes(label), {
        timeout: 5_000,
        timeoutMsg: `the window ${label} did not close`,
      })
      .catch(() => {});
  }
}
