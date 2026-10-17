/**
 * T. Closing the main window (M7 multi-window).
 *
 * `main` is a project window like any other (its label comes from `tauri.conf.json`), so
 * closing it must behave like closing any project: its own popouts go with it, and the
 * other project is untouched.
 *
 * This is its own — and the suite's last — spec, for two reasons: the label `main` cannot
 * be recreated, so the session can never return to the state every other spec's
 * `waitForApp()` expects; and it deliberately leaves one project window open, because the
 * app exits when the last window closes, which would kill the WebDriver session before
 * teardown.
 */
import { analyzerPanel } from "../support/selectors.ts";
import {
  canvasHasInk,
  closeAllTabs,
  count,
  mockReturn,
  openFixture,
  openTool,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForShell,
} from "../support/helpers.ts";
import { popOutTab } from "../support/popouts.ts";
import {
  closeCurrentWindow,
  closeWindowsMatching,
  openProjectWindow,
  windowLabels,
} from "../support/windows.ts";

/** The project window that outlives `main`. */
let second = "";

describe("T. Closing the main window", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await mockReturn("confirm", true);
  });

  after(async () => {
    // Close the popout, but leave `second` open: closing the last window exits the app
    // (no `ExitRequested` guard in `lib.rs`), which would kill the session at teardown.
    await closeWindowsMatching(/^popout-\d+$/);
    await browser.tauri.switchWindow(second).catch(() => {});
  });

  it("T1 — main's popouts close with it; the other project's popout survives", async () => {
    // The project that must survive: its own source, its own popout.
    second = await openProjectWindow();
    await browser.tauri.switchWindow(second);
    await waitForShell();
    await mockReturn("confirm", true);
    await openFixture("chirpNoise");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    const secondPopout = await popOutTab("spectrum");

    // main: a different source and its own popout.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await openFixture("sine440");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    const mainPopout = await popOutTab("spectrum");

    const before = await windowLabels();
    for (const label of ["main", second, mainPopout, secondPopout]) {
      expect(before).toContain(label);
    }

    // Close main itself — a *project* window, not a popout and not a secondary project.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await closeCurrentWindow();
    // The session is pinned to the window that just died; recover on a live one.
    await browser.tauri.switchWindow(second).catch(() => {});

    await waitFor(async () => !(await windowLabels()).includes("main"), "main did not close");
    const remaining = await windowLabels();
    expect(remaining).not.toContain(mainPopout);
    expect(remaining).toContain(second);
    expect(remaining).toContain(secondPopout);

    // The surviving popout is still a working view of its own project.
    await browser.tauri.switchWindow(secondPopout);
    await waitForShell();
    await waitFor(
      () => canvasHasInk(`${analyzerPanel("spectrum")} canvas`),
      "the surviving popout stopped rendering after main closed",
    );
    expect(await count(analyzerPanel("spectrum"))).toBe(1);
  });
});
