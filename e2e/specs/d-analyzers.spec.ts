/**
 * D. Analyzer tools — the parametrized smoke test over every tool.
 *
 * One `it` per `ANALYZER_TOOLS` entry: open the tab, wait for a non-empty result,
 * open the params + about popovers, re-select the sidebar entry to prove there is no
 * duplicate tab, then close. See `docs/testing.md` → "D. Analyzer tools".
 *
 * The suite drives **one** app instance for the whole run, so the source is loaded
 * once in `before` (`chirp_noise` gives every spectral / rhythm tool a real,
 * non-flat signal) and each tab is closed even if an assertion fails (so the next
 * spec file starts from a quiet Workbench).
 */

import { tab, analyzerPanel, analyzerAbout, analyzerParams } from "../support/selectors.ts";
import { dismissPopovers } from "../support/popups.ts";
import {
  waitForApp,
  openTool,
  closeTool,
  closeAllTabs,
  openFixture,
  waitForAnalyzer,
  waitForReadouts,
  canvasHasInk,
  canvasSignature,
  openThenClosePopover,
} from "../support/helpers.ts";
import { ANALYZER_TOOLS } from "../support/tools.ts";

/** The state of a tool-param switch, read from its underlying checkbox. */
async function switchOn(testid: string): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const input = document
      .querySelector(sel)
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    return input?.checked ?? false;
  }, testid)) as boolean;
}

describe("D. Analyzer tools — smoke (every tool)", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await openFixture("chirpNoise");
  });

  for (const tool of ANALYZER_TOOLS) {
    it(`${tool.id} (${tool.view}) opens, renders non-empty, and stays unique`, async () => {
      await openTool(tool.id);
      const panel = analyzerPanel(tool.id);
      try {
        // `tempo` is labelled "readouts" in the matrix, but the registry renders it
        // through the rhythm view (a canvas + a readout row), so treat it as a chart.
        const isCardReadouts = tool.view === "readouts" && tool.id !== "tempo";
        if (isCardReadouts) {
          await waitForReadouts(tool.id);
          expect(await $$(`${panel} .readout-card-value`).length).toBeGreaterThan(0);
        } else {
          await waitForAnalyzer(tool.id);
          expect(await canvasHasInk(`${panel} canvas`)).toBe(true);
        }

        // The params popover only exists for tools that declare per-tool params.
        if (await $(analyzerParams(tool.id)).isExisting()) {
          await openThenClosePopover(analyzerParams(tool.id));
        }
        await openThenClosePopover(analyzerAbout(tool.id));

        // Re-selecting the sidebar entry focuses the existing tab — no duplicate.
        await openTool(tool.id);
        expect(await $$(tab(tool.id)).length).toBe(1);
      } finally {
        await closeTool(tool.id);
      }
    });
  }

  it("a tool-param switch responds to a click (the spectrogram's contours)", async () => {
    // Regression: the switch row used to be a `<label>`, so a click on the control fired
    // both Kobalte's `Control` handler and the label's implicit forwarding to the hidden
    // checkbox — two toggles, no visible change. See `ToolParamsForm.ToggleParam`.
    await openTool("spectrogram");
    const panel = analyzerPanel("spectrogram");
    const field = '[data-testid="toolparam.spectrogram.showCentroid"]';
    try {
      await waitForAnalyzer("spectrogram");
      await (await $(analyzerParams("spectrogram"))).click();
      const before = await switchOn(field);
      const inkBefore = await canvasSignature(`${panel} canvas`);

      await (await $(`${field} .params-switch-control`)).click();
      await browser.pause(400);

      expect(await switchOn(field)).toBe(!before);
      expect(await canvasSignature(`${panel} canvas`)).not.toBe(inkBefore);

      // Click it back, so the tool starts the next spec on its defaults.
      await (await $(`${field} .params-switch-control`)).click();
      await browser.pause(200);
      expect(await switchOn(field)).toBe(before);
    } finally {
      await dismissPopovers();
      await closeTool("spectrogram");
    }
  });
});
