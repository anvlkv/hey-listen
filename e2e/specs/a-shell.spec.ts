/**
 * A. Shell & layout (M8) — matrix rows A1–A3 (`docs/testing.md`).
 *
 * The fixed regions (Sidebar / Source / Timeline / Workbench) are laid out by
 * `src/App.tsx`; the only tabbed area is the Workbench. These tests assert the
 * regions exist structurally, that the row splitter resizes/clamps, and that the
 * preview output controls work. No audio is asserted (headless CI has none).
 */
import { SEL } from "../support/selectors.ts";
import { waitForApp, waitFor, openFixture, pointerDrag, mockReturn } from "../support/helpers.ts";

/** The rendered height (px) of an element matched by `selector`. */
async function elementHeight(selector: string): Promise<number> {
  return (await browser.execute((sel: string) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().height : -1;
  }, selector)) as number;
}

/** The percentage readout rendered beside the preview output gain slider. */
async function outputGainReadout(): Promise<string> {
  return (await browser.execute(() => {
    const slider = document.querySelector(".toolbar-slider");
    const group = slider?.closest(".toolbar-group") ?? slider?.parentElement;
    return group?.querySelector(".toolbar-readout")?.textContent?.trim() ?? "";
  })) as string;
}

describe("A. Shell & layout", () => {
  before(async () => {
    await waitForApp();
    // A source replacement asks the core to confirm; never block a test on it.
    await mockReturn("confirm", true);
  });

  it("A1 — the fixed regions render and are not dockview tabs", async () => {
    // Sidebar, Source, Workbench and the bottom row are always-present regions
    // (the Timeline only appears once a source exists — see A2).
    for (const region of [SEL.sidebar, SEL.source, SEL.workbench, SEL.bottom]) {
      await (await $(region)).waitForExist();
    }

    // The regions live outside the Workbench and are never (or inside) a `.dv-tab`.
    const ok = await browser.execute(
      (regions: string[], workbench: string) => {
        const wb = document.querySelector(workbench);
        if (!wb || wb.closest(".dv-tab")) return false;
        return regions.every((regionSel) => {
          const region = document.querySelector(regionSel);
          if (!region) return false;
          if (region.closest(".dv-tab")) return false;
          if (region.closest(workbench)) return false;
          return true;
        });
      },
      [SEL.sidebar, SEL.bottom],
      SEL.workbench,
    );
    expect(ok).toBe(true);
  });

  it("A2 — dragging the splitter resizes the bottom row and clamps it", async () => {
    // The horizontal splitter only exists once a source is on the timeline.
    await openFixture("sine440");
    const splitter = await $(SEL.splitterTimeline);
    await splitter.waitForExist();

    const before = await elementHeight(SEL.bottom);
    expect(before).toBeGreaterThan(140);

    // Drag the splitter down: the row shrinks and clamps at its 140 px minimum.
    await pointerDrag(SEL.splitterTimeline, 0, 400);
    await waitFor(
      async () => (await elementHeight(SEL.bottom)) < before,
      "the bottom row height did not change after dragging the splitter",
    );
    expect(await elementHeight(SEL.bottom)).toBeGreaterThanOrEqual(140);
  });

  it("A3 — the output gain readout updates and the device list populates", async () => {
    await (await $(SEL.outputGain)).waitForExist();
    await (await $(SEL.outputMeter)).waitForExist();

    // Arrow-right on the gain slider must move the percentage readout. The slider's
    // keyboard-focusable control is its thumb (the Kobalte range input is hidden).
    const before = await outputGainReadout();
    const thumb = await $(".toolbar-slider .gain-thumb");
    await thumb.click();
    await browser.keys("ArrowRight");
    await waitFor(
      async () => (await outputGainReadout()) !== before,
      "the output gain readout did not change after ArrowRight",
    );

    // The output device control opens a non-empty listbox (the meter motion itself
    // needs real playback, so it is not asserted here).
    const device = await $('[aria-label="Output device"]');
    await device.waitForExist();
    await device.click();
    await waitFor(
      async () => (await $$(".pop-item").length) >= 1,
      "the output device list did not open",
    );
  });
});
