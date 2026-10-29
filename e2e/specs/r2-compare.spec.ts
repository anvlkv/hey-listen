/**
 * R2. Cross-project comparison (M25).
 *
 * Diff one analyzer across two **independently open projects**. The compare view is a
 * transient Workbench tab in the owner project (`compare:<tool>`), or its native popout;
 * each side keeps its own source, filter, window and params, and the reference project
 * is never changed.
 *
 * Two harness rules from R matter here: a window is listed before its webview boots
 * (`waitForShell()` after every switch to a new window), and every window the spec opens
 * it also closes (a session lives for the whole spec file).
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SEL, analyzerPanel, tab } from "../support/selectors.ts";
import { canvasHasInk } from "../support/analyzers.ts";
import {
  count,
  dismissPopovers,
  invokeCore,
  menuActionIn,
  mockReturn,
  openFixture,
  openSelect,
  openTabTitles,
  openTool,
  pickOption,
  textOf,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForShell,
  closeAllTabs,
} from "../support/helpers.ts";
import {
  changeReference,
  compareFromTabMenu,
  compareTab,
  popOutCompareTab,
} from "../support/compare.ts";
import {
  closeCurrentWindow,
  closeWindowsMatching,
  openProjectWindow,
  windowLabels,
} from "../support/windows.ts";

/** The compare view's root (the header + chart), per tool. */
const compareView = (tool: string) => `[data-testid="compare.${tool}"]`;
/** The comparability badge. */
const BADGE = '[data-testid="compare.badge"]';
/** The "reference project closed" banner. */
const BANNER = '[data-testid="compare.banner"]';

/** A compare view that has a live comparison shows a chart with ink. */
async function waitForCompareChart(tool: string): Promise<void> {
  const chart = `${compareView(tool)} canvas`;
  await waitFor(() => canvasHasInk(chart), `the ${tool} compare chart never drew`);
}

/** Set the shared FFT size through the current window's Toolbar popover. */
async function setFft(value: string): Promise<void> {
  await (await $(SEL.toolbarParams)).click();
  await browser.waitUntil(async () => (await $(".pop-panel")).isExisting(), {
    timeoutMsg: "the shared analysis-params popover did not open",
  });
  await openSelect('[aria-label="FFT size"]');
  await pickOption(value);
  await dismissPopovers();
}

/** The badge text in the current window. */
async function badgeText(): Promise<string> {
  return (await textOf(BADGE)).trim();
}

describe("R2. Comparison", () => {
  /** The reference project window this spec drives. */
  let second = "";

  /** Open a second project window with a distinct source; leave the session in main. */
  async function secondProject(): Promise<string> {
    if (second && (await windowLabels()).includes(second)) return second;
    second = await openProjectWindow();
    await browser.tauri.switchWindow(second);
    await waitForShell();
    await mockReturn("confirm", true);
    await openFixture("chirpNoise");
    await browser.tauri.switchWindow("main");
    await waitForShell();
    return second;
  }

  before(async () => {
    await waitForApp();
    await browser.tauri.switchWindow("main");
    await closeAllTabs();
    await mockReturn("confirm", true);
    await openFixture("sine440");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
  });

  after(async () => {
    await closeWindowsMatching(/^compare-\d+$/);
    await closeWindowsMatching(/^popout-\d+$/);
    await closeWindowsMatching(/^project-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});
  });

  it("R2.1 — Compare with… overlays both projects on one chart", async () => {
    const reference = await secondProject();
    await compareFromTabMenu("spectrum", reference);
    await waitForCompareChart("spectrum");

    expect(await count(compareView("spectrum"))).toBe(1);
    // The same tool, window, params and FFT on both sides ⇒ aligned, with a delta.
    await waitFor(async () => (await badgeText()) === "Aligned", "the compare badge never aligned");
    expect(await textOf(compareView("spectrum"))).toContain("Δ mean");
    // The compare view is its own tab, next to the analyzer it compares.
    const titles = await openTabTitles();
    expect(titles.some((title) => title.startsWith("Compare:"))).toBe(true);
    expect(titles.some((title) => title === "Spectrum")).toBe(true);
    expect(await invokeCore<{ tool: string }[]>("compare_popouts")).toEqual([]);
  });

  it("R2.2 — a differing grid shows the mismatch badge and no delta", async () => {
    await setFft("1024");
    await waitFor(
      async () => (await badgeText()) === "Grids differ",
      "the compare badge did not report the FFT mismatch",
    );
    const readouts = await textOf(compareView("spectrum"));
    expect(readouts).toContain("—"); // the Δ readouts have no value
    // Restore the shared grid so the later tests compare like with like.
    await setFft("2048");
    await waitFor(
      async () => (await badgeText()) === "Aligned",
      "the compare badge did not realign",
    );
  });

  it("R2.3 — closing the reference keeps the last result and stops live updates", async () => {
    const reference = await secondProject();
    await browser.tauri.switchWindow(reference);
    await waitForShell();
    await closeCurrentWindow();
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(
      async () => !(await windowLabels()).includes(reference),
      `${reference} did not close`,
    );
    second = "";

    await waitFor(
      async () => (await $(BANNER)).isExisting(),
      "the peer-closed banner never appeared",
    );
    // The compare view still shows the last comparison …
    expect(await count(compareView("spectrum"))).toBe(1);
    // … and the core reports the reference is gone (live updates stop).
    const live = await invokeCore<{ open: boolean }>("compare_live", { reference });
    expect(live.open).toBe(false);
  });

  it("R2.4 — saving while a compare tab is open writes the project without it", async () => {
    const tmpFile = path.join(os.tmpdir(), `heylisten-e2e-compare-${Date.now()}.heyl`);
    const label = path.basename(tmpFile, ".heyl");

    await browser.tauri.switchWindow("main");
    await waitForShell();
    await mockReturn("pick_project_save_path", tmpFile);
    await menuActionIn("main", "saveAs");
    await waitFor(() => Promise.resolve(existsSync(tmpFile)), "the project file was never written");

    // Reopen it: the compare tab is transient, so it is neither saved nor restored.
    await mockReturn("pick_project_open_path", tmpFile);
    await menuActionIn("main", "open");
    await waitFor(
      async () => (await textOf(SEL.projectName)).trim() === label,
      "main did not load the saved project",
      30_000,
    );
    expect(await count(tab(compareTab("spectrum")))).toBe(0);
    expect(await count(analyzerPanel("spectrum"))).toBe(1);
  });

  it("R2.5 — retargeting reuses the same compare tab", async () => {
    const reference = await secondProject();
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await compareFromTabMenu("spectrum", reference);
    await waitForCompareChart("spectrum");
    const before = (await openTabTitles()).length;

    // A second reference project; change the compare view to it through its tab menu.
    const other = await openProjectWindow();
    await browser.tauri.switchWindow(other);
    await waitForShell();
    await mockReturn("confirm", true);
    await openFixture("sine440");
    await browser.tauri.switchWindow("main");
    await waitForShell();

    await changeReference("spectrum", other);
    await waitFor(
      async () => !(await $(BANNER)).isExisting(),
      "the retargeted comparison never came back",
    );
    expect((await openTabTitles()).length).toBe(before);
    expect(await count(tab(compareTab("spectrum")))).toBe(1);

    await browser.tauri.switchWindow(other);
    await waitForShell();
    await closeCurrentWindow();
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(async () => !(await windowLabels()).includes(other), `${other} did not close`);
  });

  it("R2.6 — the compare popout keeps the overlay and is never restored", async () => {
    const reference = await secondProject();
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await compareFromTabMenu("spectrum", reference);
    await waitForCompareChart("spectrum");

    const popout = await popOutCompareTab("spectrum");
    await waitFor(
      async () => (await count(tab(compareTab("spectrum")))) === 0,
      "the compare tab stayed",
    );
    expect(await invokeCore<{ tool: string }[]>("compare_popouts")).toEqual([
      { tool: "spectrum", with: reference },
    ]);

    // The popout renders the same compare view (header + chart).
    await browser.tauri.switchWindow(popout);
    await waitForShell();
    await waitFor(
      async () => (await $(compareView("spectrum"))).isExisting(),
      "the compare popout did not render the view",
    );
    await waitForCompareChart("spectrum");

    // Closing it forgets the view; no tab is left behind.
    await closeCurrentWindow();
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(async () => !(await windowLabels()).includes(popout), `${popout} did not close`);
    expect(await invokeCore<{ tool: string }[]>("compare_popouts")).toEqual([]);
    expect(await count(tab(compareTab("spectrum")))).toBe(0);
  });
});
