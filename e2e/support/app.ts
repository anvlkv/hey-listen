/**
 * App lifecycle (M8): bring the shell up, and say what the window showed when it
 * does not.
 *
 * A window is drivable the moment it appears in `listWindows()`, but its webview boots
 * afterwards — so a *newly opened* project window (or a popout) needs its own wait after
 * `switchWindow`. [`waitForShell`] is that wait.
 */
import { SEL } from "./selectors.ts";
import { count, waitFor } from "./dom.ts";
import { menuAction, mockReturn } from "./ipc.ts";

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
  await ensureWindowSize();
}

/** The window size the suite drives: the app's own default (see `tauri.conf.json`). */
const WINDOW = { width: 1280, height: 800 };

/** The window's **outer** geometry this session found (restored in `afterSession`). */
let originalRect: { width: number; height: number } | null = null;

/** The window's inner size — what the app's layout is actually built from. */
async function innerSize(): Promise<{ width: number; height: number }> {
  const [width, height] = (await browser.execute(() => [
    window.innerWidth,
    window.innerHeight,
  ])) as [number, number];
  return { width, height };
}

/**
 * Give the app window the default size, so the run does not inherit the last session's.
 *
 * The app persists its window geometry (`tauri_plugin_window_state`) and restores it on
 * launch — including a window the user (or an earlier run) shrank, so every spec would
 * otherwise lay out against a different, machine-local size. Best-effort: the compare
 * view scrolls rather than collapsing its chart (see `styles/compare.css`), so a resize
 * the window manager refuses means a smaller chart, not a failure. [`restoreWindowSize`]
 * puts the user's own geometry back at the end of the session.
 */
async function ensureWindowSize(): Promise<void> {
  const inner = await innerSize();
  if (inner.width >= WINDOW.width && inner.height >= 600) return;
  // The rect the driver reports is the **outer** window: its chrome (the title bar) is
  // the difference from the page's inner size — measure it rather than assume it.
  const outer = await browser.getWindowSize().catch(() => null);
  const chrome = {
    width: Math.max(0, (outer?.width ?? inner.width) - inner.width),
    height: Math.max(0, (outer?.height ?? inner.height) - inner.height),
  };
  originalRect = outer ?? null;
  await browser
    .setWindowSize(WINDOW.width + chrome.width, WINDOW.height + chrome.height)
    .catch((err) => console.error("could not size the app window", err));
  await browser
    .waitUntil(async () => (await innerSize()).width >= WINDOW.width - 40, {
      timeout: 5_000,
      timeoutMsg: "the app window stayed narrow",
    })
    .catch((err) => console.error("the app window stayed narrow:", err.message));
}

/** Put `main` back to the size this session found it at (a test run must not resize it). */
export async function restoreWindowSize(): Promise<void> {
  const rect = originalRect;
  originalRect = null;
  if (!rect) return;
  await browser.tauri.switchWindow("main").catch(() => {});
  await browser
    .setWindowSize(rect.width, rect.height)
    .catch((err) => console.error("could not restore the app window size", err));
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

/**
 * File → New, then wait until the timeline is actually gone.
 *
 * The menu action is an **event**: `emit` returns before the frontend has reset the
 * project. A caller that immediately re-opens a fixture would read the previous
 * source's duration in the Timeline readout and `openFixture` would skip the open as
 * "already loaded" — then the reset lands and the timeline stays empty (the Windows CI
 * hit exactly that in Q6). Wait for the empty state, not just for the emit.
 */
export async function newEmptyProject(): Promise<void> {
  await mockReturn("confirm", true);
  await menuAction("new");
  await waitFor(
    async () => (await count(SEL.timeline)) === 0,
    "New Project did not clear the timeline",
  );
}
