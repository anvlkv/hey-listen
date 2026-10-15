/**
 * H. Project file (M6) & multi-window (M7) — matrix rows H1–H2 (`docs/testing.md`).
 *
 * Native menus cannot be clicked by WebDriver, so File actions are driven through
 * the `app:menu` event the frontend listens for (`src/state/menu.ts`), with the
 * native path dialogs stubbed via `mockReturn`. H2 pops a tab out into a real Tauri
 * window and checks the popout stays a single view of the project.
 *
 * Each spec file starts a fresh app session (WebdriverIO creates a session per
 * spec), so the window here begins with no source.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL, sidebarTool, tab, analyzerPanel } from "../support/selectors.ts";
import {
  waitForApp,
  openTool,
  openFixture,
  mockReturn,
  restoreMocks,
  menuAction,
  waitForSourceLoaded,
  waitFor,
  openTabTitles,
  canvasHasInk,
  waitForAnalyzer,
  count,
  closeAllTabs,
} from "../support/helpers.ts";
import { closeWindowsMatching, windowLabels } from "../support/windows.ts";

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function timelineReadout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/** Reveal the Source panel when a source is already loaded (it hides once loaded). */
async function revealSourcePanel(): Promise<void> {
  if (!(await $('[data-testid="source.kind"]').isExisting())) {
    await (await $(SEL.timelineReplace)).click();
  }
}

/** Right-click an element (WKWebView won't synthesise `contextmenu` from pointer actions). */
async function rightClick(selector: string): Promise<void> {
  const el = await $(selector);
  await el.waitForExist();
  await browser.execute((sel: string) => {
    const target = document.querySelector(sel) as HTMLElement | null;
    if (!target) throw new Error(`rightClick: no element for ${sel}`);
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 2,
        buttons: 2,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  }, selector);
}

describe("H. Project file & multi-window", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // Replacing a source / discarding unsaved work asks the core to confirm.
    await mockReturn("confirm", true);
  });

  afterEach(async () => {
    await restoreMocks();
    await mockReturn("confirm", true);
  });

  // Leave a single-window app behind: the specs that follow (K, L) assume the project
  // window, and H2 pops a tab out into a real `popout-*` window. Close it here — the
  // spec that opens a secondary window is the one that should close it.
  after(async () => {
    await closeWindowsMatching(/^popout-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});
  });

  it("H1 — a saved project reloads its source and setup", async () => {
    await openFixture("sine440");

    const tmpFile = path.join(os.tmpdir(), `heylisten-e2e-${Date.now()}.heyl`);
    const label = path.basename(tmpFile, ".heyl");

    // Save As: the native path dialog is stubbed, then the real `save_project` runs.
    await mockReturn("pick_project_save_path", tmpFile);
    await menuAction("saveAs");

    // The core writes the file; wait for it on disk and for the toolbar to adopt it.
    await waitFor(
      () => Promise.resolve(existsSync(tmpFile)),
      "the project file was never written to disk",
      20_000,
    );
    await waitFor(
      async () => (await (await $(SEL.projectName)).getText()).trim() === label,
      "the toolbar never showed the saved project's name",
    );

    // Change the project: open a different source, replacing the whole timeline.
    await revealSourcePanel();
    await openFixture("chirpNoise");
    await waitFor(
      async () => (await timelineReadout()).includes("0:03"),
      "the replacement (chirp) source did not load",
    );

    // Open the saved project back — the 2 s sine source must return.
    await mockReturn("pick_project_open_path", tmpFile);
    await menuAction("open");

    await waitForSourceLoaded();
    await waitFor(
      async () => (await timelineReadout()).includes("0:02"),
      "the loaded project did not restore the sine source",
    );
    await waitFor(
      () => canvasHasInk(SEL.timelineCanvas),
      "the timeline did not render after loading the project",
    );
  });

  it("H2 — 'Pop out to window' shows a single tool; the sidebar raises it (no duplicate)", async () => {
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");

    // Right-click the tab: dockview renders its own context menu (`.dv-context-menu`).
    await rightClick(tab("spectrum"));
    const menu = await $(".dv-context-menu");
    await menu.waitForExist();
    const items = await menu.$$(".dv-context-menu-item");
    let popped = false;
    for (const item of items) {
      if ((await item.getText()).trim() === "Pop out to window") {
        await item.click();
        popped = true;
        break;
      }
    }
    expect(popped).toBe(true);

    // The tab leaves the main Workbench (it becomes a native window instead).
    await waitFor(
      async () => (await count(tab("spectrum"))) === 0,
      "the popped-out tab stayed in the main Workbench",
    );

    // A fresh `popout-<n>` window exists and renders exactly the one tool.
    let popout = "";
    await waitFor(async () => {
      popout = (await windowLabels()).find((l) => /^popout-\d+$/.test(l)) ?? "";
      return popout !== "";
    }, "no popout-* window appeared");

    await browser.tauri.switchWindow(popout);
    // The popout shell (`region.popout`) renders exactly the one tool.
    await waitFor(
      async () => (await count('[data-testid="region.popout"]')) > 0,
      "the popout never rendered its shell",
    );
    const panel = await $(analyzerPanel("spectrum"));
    await panel.waitForExist();
    await waitFor(
      () => canvasHasInk(`${analyzerPanel("spectrum")} canvas`),
      "the popout did not render the tool's chart",
    );

    // Back on main, selecting the tool in the Sidebar must raise the popout, not open
    // a duplicate tab. (The popout is closed in the suite's `after` hook, so the
    // following specs start from a single window.)
    await browser.tauri.switchWindow("main");
    const before = await openTabTitles();
    const entry = await $(sidebarTool("spectrum"));
    await entry.waitForExist();
    await entry.click();
    // Give the `focus_popout` IPC round-trip a beat, then assert main is unchanged.
    await browser.pause(400);
    expect(await openTabTitles()).toEqual(before);
    expect(await count(tab("spectrum"))).toBe(0);
  });
});
