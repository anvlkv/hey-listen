/**
 * Tauri window helpers for the multi-window specs (M7+): listing a session's windows,
 * closing the focused one, and cleaning up the popout windows a spec leaves behind.
 *
 * A spec file gets one app session, so a spec that pops a window out owns closing it —
 * see `docs/testing.md` → E2E testing.
 */

/**
 * Close the window the test is currently focused on.
 *
 * Fire-and-forget: it runs the app's own `close_window` command (`window.destroy()`),
 * which tears the caller down before the IPC reply can be delivered — awaiting it
 * would hang. The frontend's `onCloseRequested` guard prevents a *native* close and
 * routes it through this command, so going through it is the supported path.
 */
export async function closeCurrentWindow(): Promise<void> {
  await browser.tauri.execute((tauri) => {
    void tauri.core.invoke("close_window").catch(() => {});
  });
}

/**
 * The labels of every open Tauri window. `listWindows()` shape is not relied upon:
 * handles may be plain strings or objects carrying a `label`/`handle`.
 */
export async function windowLabels(): Promise<string[]> {
  const windows = (await browser.tauri.listWindows()) as unknown;
  if (!Array.isArray(windows)) return [];
  return windows.map((w) => {
    if (typeof w === "string") return w;
    const obj = w as { label?: string; handle?: string; name?: string };
    return obj.label ?? obj.handle ?? obj.name ?? "";
  });
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
