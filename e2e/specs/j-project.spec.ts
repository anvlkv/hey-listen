/**
 * H. Project file (M6) & multi-window (M7) — matrix rows H1–H4 (`docs/testing.md`).
 *
 * Native menus cannot be clicked by WebDriver, so File actions are driven through
 * the `app:menu` event the frontend listens for (`src/state/menu.ts`), with the
 * native path dialogs stubbed via `mockReturn`. H2 pops a tab out into a real Tauri
 * window and checks the popout stays a single view of the project. H4 opens the
 * committed version-1 project, so the loader's migration chain runs in the real app.
 *
 * Each spec file starts a fresh app session (WebdriverIO creates a session per
 * spec), so the window here begins with no source.
 */
import { copyFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL, sidebarTool, tab, analyzerPanel } from "../support/selectors.ts";
import { LEGACY_PROJECT } from "../support/fixtures.ts";
import {
  waitForApp,
  waitForShell,
  openTool,
  activateToolSection,
  openFixture,
  mockReturn,
  closeAllTabs,
  menuAction,
  waitForSourceLoaded,
  waitFor,
  openTabTitles,
  canvasHasInk,
  waitForAnalyzer,
  invokeCore,
  count,
} from "../support/helpers.ts";
import { popOutTab } from "../support/popouts.ts";
import { projectSessionHooks } from "../support/session.ts";
import { closeCurrentWindow, closeWindowsMatching, windowLabels } from "../support/windows.ts";

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function timelineReadout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/** The container's header version (`+4`, u32 LE) — see `docs/project-file-format.md`. */
function fileVersion(file: string): number {
  return readFileSync(file).readUInt32LE(4);
}

/**
 * Reveal the Source panel when a source is already loaded (it hides once loaded).
 */
async function revealSourcePanel(): Promise<void> {
  if (!(await $('[data-testid="source.kind"]').isExisting())) {
    await (await $(SEL.timelineReplace)).click();
  }
}

describe("H. Project file & multi-window", () => {
  // H2 pops a tab out into a real `popout-*` window; close it here so the specs that
  // follow (K, L) start on a single project window.
  projectSessionHooks(/^popout-\d+$/);

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

  it("H4 — a version 1 project upgrades on open and saves as version 2", async () => {
    // Work on a copy: saving the migrated project rewrites the file.
    const tmpFile = path.join(os.tmpdir(), `heylisten-e2e-v1-${Date.now()}.heyl`);
    await copyFile(LEGACY_PROJECT, tmpFile);
    expect(fileVersion(tmpFile)).toBe(1);

    await mockReturn("pick_project_open_path", tmpFile);
    await menuAction("open");
    await waitForSourceLoaded();
    await waitFor(
      async () => (await timelineReadout()).includes("0:04"),
      "the version 1 project's audio did not load",
    );

    // The Toolbar reports the upgrade and the project stays dirty: the upgrade only
    // becomes durable when it is saved (`docs/project-file-format.md` → Migrations).
    const notice = await $(SEL.projectUpgraded);
    await notice.waitForExist();
    expect(await notice.getText()).toContain("upgraded from v1");
    await waitFor(
      async () => (await (await $(SEL.projectName)).getText()).includes("*"),
      "the upgraded project was not marked dirty",
    );

    // Save in place: the file becomes the current version and the notice clears.
    await menuAction("save");
    await waitFor(
      () => Promise.resolve(fileVersion(tmpFile) === 2),
      "saving did not write the current format version",
    );
    await waitFor(
      async () => !(await $(SEL.projectUpgraded).isExisting()),
      "the upgrade notice stayed after a save",
    );
    await waitFor(
      async () => !(await (await $(SEL.projectName)).getText()).includes("*"),
      "the saved project stayed dirty",
    );
  });

  it("H2 — 'Pop out to window' shows a single tool; the sidebar raises it (no duplicate)", async () => {
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");

    // Right-click the tab → "Pop out to window" (dockview renders its own context menu).
    const popout = await popOutTab("spectrum");

    // The tab leaves the main Workbench (it becomes a native window instead).
    await waitFor(
      async () => (await count(tab("spectrum"))) === 0,
      "the popped-out tab stayed in the main Workbench",
    );

    // A fresh `popout-<n>` window exists and renders exactly the one tool.
    await browser.tauri.switchWindow(popout);
    // The popout shell (`region.popout`) renders exactly the one tool.
    await waitFor(async () => (await count(SEL.popout)) > 0, "the popout never rendered its shell");
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
    await activateToolSection("spectrum");
    const entry = await $(sidebarTool("spectrum"));
    await entry.waitForExist();
    await entry.click();
    // Give the `focus_popout` IPC round-trip a beat, then assert main is unchanged.
    await browser.pause(400);
    expect(await openTabTitles()).toEqual(before);
    expect(await count(tab("spectrum"))).toBe(0);
  });

  it("H3 — a closed popout returns its tool to a tab when selected again", async () => {
    // H2 leaves its popout open; start from the project window with no popouts.
    await waitForApp();
    await closeAllTabs();
    await closeWindowsMatching(/^popout-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});

    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    const popout = await popOutTab("spectrum");
    await waitFor(
      async () => (await count(tab("spectrum"))) === 0,
      "the tab stayed in the main Workbench",
    );
    expect(await invokeCore<string[]>("popout_tools")).toEqual(["spectrum"]);

    // Closing the popout window closes that view, and the core forgets the tool is out.
    await browser.tauri.switchWindow(popout);
    await waitForShell();
    await closeCurrentWindow();
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(async () => !(await windowLabels()).includes(popout), "the popout did not close");
    expect(await invokeCore<string[]>("popout_tools")).toEqual([]);

    // …so selecting the tool again opens a **tab**, not a dead window.
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    expect(await count(tab("spectrum"))).toBe(1);
  });
});
