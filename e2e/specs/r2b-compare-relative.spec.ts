/**
 * R2b. Comparison — relative-time alignment (M25.B).
 *
 * The two sides share one **relative** axis (each window starts at 0) with a fine-tune
 * offset δ; the delta covers the common span (the longer side clipped to the shorter).
 * Kept in its own spec file because `r2-compare.spec.ts` is already at the source-size
 * budget, and every window opened here is also closed here.
 */
import { tab } from "../support/selectors.ts";
import {
  click,
  closeAllTabs,
  closeTool,
  count,
  invokeCore,
  mockReturn,
  openFixture,
  openTool,
  textOf,
  waitFor,
  waitForApp,
  waitForShell,
} from "../support/helpers.ts";
import {
  compareToolFromMain,
  compareView,
  openProjectWithFixture,
  waitForBadge,
  waitForCompareChart,
} from "../support/compare.ts";
import { closeCurrentWindow, closeWindowsMatching, windowLabels } from "../support/windows.ts";

describe("R2b. Comparison — relative alignment", () => {
  /** The chirp reference project (`secondProject`). */
  let second = "";

  /** Open a second project window with a distinct source; leave the session in main. */
  async function secondProject(): Promise<string> {
    if (second && (await windowLabels()).includes(second)) return second;
    second = await openProjectWithFixture("chirpNoise");
    return second;
  }

  /** Open `tool` in main and compare it with `reference` through the tab menu. */
  async function compareTool(tool: string, reference: string): Promise<void> {
    await compareToolFromMain(tool, reference);
  }

  before(async () => {
    await waitForApp();
    await browser.tauri.switchWindow("main");
    await closeAllTabs();
    await mockReturn("confirm", true);
    await openFixture("sine440");
  });

  after(async () => {
    await closeWindowsMatching(/^compare-\d+$/);
    await closeWindowsMatching(/^popout-\d+$/);
    await closeWindowsMatching(/^project-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});
  });

  it("R2.11 — the waveform overlays and clips a differing window", async () => {
    // A third project with the **same** source as main (sine440), so the two analysis
    // windows start out identical.
    const same = await openProjectWithFixture("sine440");

    await compareTool("waveform", same);
    await waitForCompareChart("waveform");
    // Identical windows: no clipping note, one overlay.
    expect(await count('[data-testid="compare.waveform.side"]')).toBe(0);
    expect(await count('[data-testid="compare.waveform.note"]')).toBe(0);
    expect(await textOf('[data-testid="compare.waveform"]')).toContain("Buckets");

    // Move the reference's analysis window: the buckets no longer align, so the delta
    // clips to the common span and the chart says so — it still overlays (M25.B).
    await browser.tauri.switchWindow(same);
    await waitForShell();
    await invokeCore("set_ui_state", {
      key: "timeline",
      value: { windowStart: 0.5, windowEnd: 2, viewStart: 0.5, viewEnd: 2 },
    });
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await waitFor(
      async () => (await count('[data-testid="compare.waveform.note"]')) === 1,
      "the clipping note never appeared",
    );
    expect(await count('[data-testid="compare.waveform.side"]')).toBe(0);

    await browser.tauri.switchWindow(same);
    await waitForShell();
    await closeCurrentWindow();
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(async () => !(await windowLabels()).includes(same), `${same} did not close`);
  });

  it("R2.12 — adjacent windows compare from 0, the offset and swap follow", async () => {
    const reference = await secondProject();
    await compareTool("frameRms", reference);
    await waitForCompareChart("frameRms");
    await waitForBadge("Aligned");

    // Move the reference window: it now starts later and is shorter. On the relative
    // axis the comparison stays aligned and the delta covers the common span.
    await browser.tauri.switchWindow(reference);
    await waitForShell();
    await invokeCore("set_ui_state", {
      key: "timeline",
      value: { windowStart: 0.5, windowEnd: 2, viewStart: 0.5, viewEnd: 2 },
    });
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await waitForBadge("Aligned");
    await waitFor(
      async () => (await count('[data-testid="compare.span"]')) === 1,
      "the common-span note never appeared",
    );
    expect(await textOf('[data-testid="compare.span"]')).toContain("common span");

    // The fine-tune slider moves the reference: 500 ms later shifts the common span.
    const moved = await browser.execute(() => {
      const input = document.querySelector(
        '[data-testid="compare.offset"]',
      ) as HTMLInputElement | null;
      if (!input) return false;
      input.value = "0.5";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    expect(moved).toBe(true);
    await waitFor(
      async () => (await textOf('[data-testid="compare.offset.value"]')).includes("500 ms"),
      "the offset value never updated",
    );
    await waitFor(
      async () => (await textOf('[data-testid="compare.span"]')).includes("0.50"),
      "the common span did not follow the offset",
    );

    // Swap moves the axis/clipping with the sides: displayed A is now the reference
    // (1.5 s), which the common span covers, so the clipping note clears.
    await click('[data-testid="compare.swap"]');
    await waitForBadge("Aligned");
    await waitFor(
      async () => (await count('[data-testid="compare.span"]')) === 0,
      "the swapped view still claimed a clipped span",
    );
    expect(await textOf('[data-testid="compare.offset.value"]')).toContain("500 ms");

    // Opening another analyzer tab must not drop the reference (M25.B regression).
    // Closing it again returns to the compare tab, which is still bound: a panel
    // add/remove used to prune every reference because it was derived from `openTools`.
    await openTool("mfcc");
    await waitFor(async () => (await count(tab("mfcc"))) === 1, "the mfcc tab did not open");
    await closeTool("mfcc");
    await waitFor(
      async () => (await count('[data-testid="compare.badge"]')) === 1,
      "the compare view lost its reference when another tab opened",
    );
    expect(await textOf(compareView("frameRms"))).toContain("Δ mean");
  });
});
