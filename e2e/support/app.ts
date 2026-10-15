/**
 * App lifecycle (M8): bring the shell up, and say what the window showed when it
 * does not.
 */
import { SEL } from "./selectors.ts";
import { count } from "./dom.ts";

/**
 * Wait until the shell has rendered (the fixed regions are present).
 *
 * The app instance is launched **once for the whole run** and reused across spec
 * files, so a spec that leaves a popout window focused (J2) would otherwise leave the
 * *next* session pointed at that popout — which renders no Workbench. Switch to the
 * `main` window first so every spec starts on the project window.
 */
export async function waitForApp(): Promise<void> {
  await selectMainWindow();
  try {
    await browser.waitUntil(async () => (await count(SEL.workbench)) > 0, {
      timeoutMsg: "the app shell did not render",
    });
  } catch (err) {
    // A bare timeout says nothing about *why*: report what the window actually shows
    // (a partially mounted app is a very different bug from an empty document), and
    // let the app's own `[startup]` logs — which `src/boot.ts` sends to the log file
    // and, under the suite, to this run's frontend log — carry the error itself.
    throw new Error(`${(err as Error).message}\n${await describeWindow()}`, { cause: err });
  }
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
