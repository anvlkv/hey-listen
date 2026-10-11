/**
 * F. Cross-cutting analyzer behavior (F1–F5).
 *
 * Search, no-duplicate tabs, shared-params re-run, cross-tab zoom sync, and the
 * per-tool popovers. See `docs/testing.md` → "F. Cross-cutting analyzer behavior".
 */

import {
  SEL,
  sidebarTool,
  tab,
  analyzerPanel,
  analyzerAbout,
  analyzerParams,
} from "../support/selectors.ts";
import {
  waitForApp,
  openTool,
  closeTool,
  openFixture,
  waitForAnalyzer,
  canvasHasInk,
  readoutValue,
  openSelect,
  pickOption,
  openThenClosePopover,
  dismissPopovers,
  closeAllTabs,
  activateTab,
} from "../support/helpers.ts";

/** Kobalte portals every popover panel with this class. */
const POP_PANEL = ".pop-panel";
/** The Sidebar tools (analyzer entries + the two graph editors) share this prefix. */
const SIDEBAR_TOOL = '[data-testid^="sidebar.tool."]';

describe("F. Cross-cutting analyzer behavior", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await openFixture("sine440");
  });

  it("F1 search filters the analyzer list but keeps the graph editors", async () => {
    const total = await $$(SIDEBAR_TOOL).length;
    expect(total).toBeGreaterThan(0);

    const search = await $(SEL.sidebarSearch);
    await search.waitForExist();
    await search.setValue("pitch");

    await browser.waitUntil(async () => (await $$(SIDEBAR_TOOL).length) < total, {
      timeoutMsg: "the analyzer list did not filter on the search query",
    });

    // The Graphs section is not filtered, so both graph editors stay visible.
    expect(await $(sidebarTool("filter")).isDisplayed()).toBe(true);
    expect(await $(sidebarTool("synth")).isDisplayed()).toBe(true);

    await search.setValue("");
  });

  it("F2 opening a tool twice keeps a single tab", async () => {
    await openTool("spectrum");
    await openTool("spectrum");
    expect(await $$(tab("spectrum")).length).toBe(1);
    await closeTool("spectrum");
  });

  it("F3 changing the shared FFT size re-runs every open tool", async () => {
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");

    const before = await readoutValue("spectrum", "FFT");
    expect(before).toBeTruthy();

    // Change FFT size through the toolbar's shared "Analysis params" popover.
    const params = await $(SEL.toolbarParams);
    await params.waitForExist();
    await params.click();
    await browser.waitUntil(async () => (await $(POP_PANEL)).isExisting(), {
      timeoutMsg: "the shared analysis-params popover did not open",
    });

    await openSelect('[aria-label="FFT size"]');
    await pickOption("1024");

    // Close the shared params popover so it doesn't obscure the charts.
    await dismissPopovers();

    // The spectrum readout reports the FFT size it actually ran with ⇒ it re-ran.
    await activateTab("spectrum");
    await waitForAnalyzer("spectrum");
    await browser.waitUntil(
      async () => ((await readoutValue("spectrum", "FFT")) ?? "").includes("1024"),
      { timeoutMsg: "spectrum did not re-run with the new FFT size" },
    );

    // A second tool mounts fresh under the same shared param ⇒ both agree.
    await openTool("spectralCentroid");
    await waitForAnalyzer("spectralCentroid");
    expect(await canvasHasInk(`${analyzerPanel("spectralCentroid")} canvas`)).toBe(true);
  });

  it("F4 zooming one time chart mirrors the visible range to its peers", async () => {
    await openTool("waveform");
    await waitForAnalyzer("waveform");

    // Drive the explicit "Zoom in" control: it calls uPlot's x `setScale`, which
    // the `syncView("time")` plugin mirrors through the shared chart bus.
    const zoomIn = await $(`${analyzerPanel("waveform")} .zoom-btn[title="Zoom in"]`);
    await zoomIn.waitForExist();
    await zoomIn.click();
    const driverReadout = () => `${analyzerPanel("waveform")} .zoom-readout`;
    await browser.waitUntil(
      async () => ((await (await $(driverReadout())).getText()) ?? "") !== "",
      { timeoutMsg: "the waveform zoom readout never appeared" },
    );
    const driver = await (await $(driverReadout())).getText();

    // Dockview unmounts the hidden panel; opening the peer mounts it fresh, where it
    // reads the shared time view — so its visible range matches the driver's.
    await openTool("spectralCentroid");
    await waitForAnalyzer("spectralCentroid");
    const peerReadout = await (
      await $(`${analyzerPanel("spectralCentroid")} .zoom-readout`)
    ).getText();
    expect(peerReadout).toBe(driver);
  });

  it("F5 params and about popovers render for a tool", async () => {
    await openTool("spectrum");
    await openThenClosePopover(analyzerAbout("spectrum"));
    if (await $(analyzerParams("spectrum")).isExisting()) {
      await openThenClosePopover(analyzerParams("spectrum"));
    }
    await closeTool("spectrum");
  });
});
