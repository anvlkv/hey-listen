/**
 * App lifecycle (M8): bring the shell up, and say what the window showed when it
 * does not.
 *
 * A window is drivable the moment it appears in `listWindows()`, but its webview boots
 * afterwards — so a *newly opened* project window (or a popout) needs its own wait after
 * `switchWindow`. [`waitForShell`] is that wait.
 */
import { SEL } from "./selectors.ts";
import { count } from "./dom.ts";

/** Wait until `condition` holds, appending what the window actually showed on failure. */
async function waitForWindow(
  condition: () => Promise<boolean>,
  timeoutMsg: string,
  timeout?: number,
): Promise<void> {
  try {
    await browser.waitUntil(
      condition,
      // Omit `timeout` entirely when unset, so WDIO applies its own `waitforTimeout`.
      timeout === undefined ? { timeoutMsg } : { timeout, timeoutMsg },
    );
  } catch (err) {
    // A bare timeout says nothing about *why*: report what the window shows (a partially
    // mounted app is a very different bug from an empty document), and let the app's own
    // `[startup]` logs — which `src/boot.ts` sends to the log file and, under the suite,
    // to this run's frontend log — carry the error itself.
    throw new Error(`${(err as Error).message}\n${await describeWindow()}`, { cause: err });
  }
}

/**
 * Wait until the **current** window has rendered a shell: the app (a project window) or
 * a single tool (`region.popout`).
 *
 * Needed after switching to a window that was just created: `switchWindow` succeeds as
 * soon as the label exists, which is *before* the new webview has mounted anything.
 */
export async function waitForShell(timeout = 20_000): Promise<void> {
  await waitForWindow(
    async () => (await count(SEL.workbench)) > 0 || (await count(SEL.popout)) > 0,
    "the window never rendered a shell (neither the app nor a popout)",
    timeout,
  );
}

/**
 * Wait until the shell has rendered (the fixed regions are present) in the `main` window.
 *
 * The app instance is launched **once for the whole run** and reused across spec files,
 * so a spec that leaves a popout window focused (H2) would otherwise leave the *next*
 * session pointed at that popout — which renders no Workbench. Switch to the `main`
 * window first so every spec starts on the project window.
 */
export async function waitForApp(): Promise<void> {
  await selectMainWindow();
  await waitForWindow(async () => (await count(SEL.workbench)) > 0, "the app shell did not render");
}

/** What the window currently shows, for a failure message (best-effort). */
async function describeWindow(): Promise<string> {
  try {
    const shown = await browser.execute(() => ({
      href: location.href,
      readyState: document.readyState,
      rootChildren: document.getElementById("root")?.childElementCount ?? -1,
      testIds: Array.from(document.querySelectorAll("[data-testid]")).map((el) =>
        el.getAttribute("data-testid"),
      ),
      body: document.body?.innerHTML?.slice(0, 600) ?? "",
    }));
    return `window: ${JSON.stringify(shown, null, 2)}`;
  } catch (err) {
    return `window: unavailable (${String(err)})`;
  }
}

/** The release binary launches a "main" window; make sure it is the active one. */
export async function selectMainWindow(): Promise<void> {
  await browser.tauri.switchWindow("main").catch(() => {});
}
