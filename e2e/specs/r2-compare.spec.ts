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
import { SEL, tab } from "../support/selectors.ts";
import {
  count,
  invokeCore,
  menuActionIn,
  mockReturn,
  openFixture,
  openTabTitles,
  openTool,
  textOf,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForShell,
  closeAllTabs,
  click,
} from "../support/helpers.ts";
import {
  changeReference,
  compareFromTabMenu,
  compareTab,
  compareView,
  popOutCompareTab,
  setFft,
  waitForBadge,
  waitForCompareChart,
} from "../support/compare.ts";
import {
  closeCurrentWindow,
  closeWindowsMatching,
  openProjectWindow,
  windowLabels,
} from "../support/windows.ts";

/** The "reference project closed" banner. */
const BANNER = '[data-testid="compare.banner"]';

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
    await waitForBadge("Aligned");
    expect(await textOf(compareView("spectrum"))).toContain("Δ mean");
    // The compare view is its own tab, next to the analyzer it compares.
    const titles = await openTabTitles();
    expect(titles.some((title) => title.startsWith("Compare:"))).toBe(true);
    expect(titles.some((title) => title === "Spectrum")).toBe(true);
    expect(await invokeCore<{ tool: string }[]>("compare_popouts")).toEqual([]);
  });

  it("R2.2 — a differing grid shows the mismatch badge and no delta", async () => {
    await setFft("1024");
    await waitForBadge("Grids differ");
    const readouts = await textOf(compareView("spectrum"));
    expect(readouts).toContain("—"); // the Δ readouts have no value
    // Restore the shared grid so the later tests compare like with like.
    await setFft("2048");
    await waitForBadge("Aligned");
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
    // The compare tab is transient: it is never written to the project file, so reopening
    // does not restore it. The project name updates first and the Workbench layout a
    // moment later, so this is polled rather than read once.
    await waitFor(
      async () => (await openTabTitles()).every((title) => !title.startsWith("Compare:")),
      "the compare tab was restored",
    );
    // The analyzer tab it was opened from is restored…
    await waitFor(
      async () => (await count(tab("spectrum"))) > 0,
      "the spectrum tab was not restored",
    );
    await waitForAnalyzer("spectrum");
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

    // Both reference projects are offerable, so the picker has something to show.
    const targets = await invokeCore<{ label: string }[]>("compare_targets");
    expect(targets.map((target) => target.label)).toEqual(
      expect.arrayContaining([reference, other]),
    );

    await changeReference("spectrum", other);
    // Absence is polled in-page: awaiting `$(sel)` for a missing element throws, so
    // `isExisting()` can never settle a "is gone" wait.
    await waitFor(
      async () => (await count(BANNER)) === 0,
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

  // --- M25.A: the remaining chart families ---------------------------------

  /** Open one analyzer in main and compare it with `reference` through the tab menu. */
  async function compareTool(tool: string, reference: string): Promise<void> {
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await openTool(tool);
    // Not `waitForAnalyzer`: a family's analyzer view legitimately shows its empty state
    // for one fixture (no notes / no modulation), which is not a failure here.
    await waitFor(async () => (await count(tab(tool))) === 1, `the ${tool} tab did not open`);
    await compareFromTabMenu(tool, reference);
    await waitFor(
      async () => (await count(compareView(tool))) === 1,
      `the ${tool} compare view did not open`,
    );
  }

  it("R2.7 — the matrix view switches A / B / Δ and never interpolates", async () => {
    const reference = await secondProject();
    await compareTool("mfcc", reference);
    await waitForCompareChart("mfcc");
    expect(await count('[data-testid="compare.matrix"]')).toBe(1);

    // A / B / Δ: Δ adds the zero-centred legend and paints a diverging ramp.
    await click('[data-testid="compare.matrix.mode.b"]');
    await click('[data-testid="compare.matrix.mode.delta"]');
    await waitFor(
      async () => (await count('[data-testid="compare.matrix.legend"]')) === 1,
      "the Δ legend never appeared",
    );
    expect(await textOf('[data-testid="compare.matrix.legend"]')).toContain("B − A");

    // A differing grid: two side-by-side heatmaps, and no Δ switch.
    await setFft("1024");
    await waitForBadge("Grids differ");
    await waitFor(
      async () => (await count('[data-testid="compare.matrix.side"]')) === 1,
      "the side-by-side heatmaps never appeared",
    );
    expect(await count('[data-testid="compare.matrix.mode"]')).toBe(0);

    await setFft("2048");
    await waitForBadge("Aligned");
    await waitFor(
      async () => (await count('[data-testid="compare.matrix.mode"]')) === 1,
      "the A/B/Δ switch never came back",
    );
  });

  it("R2.8 — the rhythm view pairs events and marks one-sided ones", async () => {
    const reference = await secondProject();
    await compareTool("onsets", reference);
    await waitForCompareChart("onsets");
    const summary = await textOf('[data-testid="compare.events.summary"]');
    expect(summary).toContain("matched");
    expect(summary).toContain("only A");
    expect(summary).toContain("only B");
  });

  it("R2.9 — the note view pairs notes and shows A / B / Δ rows", async () => {
    const reference = await secondProject();
    await compareTool("noteMetrics", reference);
    await waitFor(
      async () => (await count('[data-testid="compare.notes.table"]')) === 1,
      "the note compare table never appeared",
    );
    const table = await textOf('[data-testid="compare.notes.table"]');
    expect(table).toContain("A start");
    expect(table).toContain("Δ RMS");
    expect(await count('[data-testid^="compare.notes.row."]')).toBeGreaterThan(0);
    await waitForCompareChart("noteMetrics");
  });

  it("R2.10 — the modulation view switches AM / FM on the rate axis", async () => {
    // A steady tone has no modulation spectrum, so both sides use the chirp here — the
    // view is exercised with data on both sides rather than its (correct) empty state.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await openFixture("chirpNoise");
    const reference = await secondProject();
    await compareTool("modulation", reference);
    await waitForCompareChart("modulation");
    await click('[data-testid="compare.modulation.mode.fm"]');
    expect(await count('[data-testid="compare.modulation.mode"]')).toBe(1);
    const pressed = await browser.execute(
      () =>
        document
          .querySelector('[data-testid="compare.modulation.mode.fm"]')
          ?.getAttribute("aria-pressed") ?? "",
    );
    expect(pressed).toBe("true");
    expect(await textOf('[data-testid="compare.modulation"]')).toContain("Δ AM mean");

    // Restore main's source for the waveform test's identical-window case.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await openFixture("sine440");
  });

  it("R2.11 — the waveform overlays only an identical window", async () => {
    // A third project with the **same** source as main (sine440), so the two analysis
    // windows start out identical — the rule under test.
    const same = await openProjectWindow();
    await browser.tauri.switchWindow(same);
    await waitForShell();
    await mockReturn("confirm", true);
    await openFixture("sine440");

    await compareTool("waveform", same);
    await waitForCompareChart("waveform");
    expect(await count('[data-testid="compare.waveform.side"]')).toBe(0);
    expect(await textOf('[data-testid="compare.waveform"]')).toContain("Buckets");

    // Move the reference's analysis window: bucket i now covers a different span, so
    // the envelopes are drawn side by side and no envelope delta is claimed.
    await browser.tauri.switchWindow(same);
    await waitForShell();
    await invokeCore("set_ui_state", {
      key: "timeline",
      value: { windowStart: 0.5, windowEnd: 2, viewStart: 0.5, viewEnd: 2 },
    });
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await waitFor(
      async () => (await count('[data-testid="compare.waveform.side"]')) === 1,
      "the differing windows never switched to side-by-side",
    );
    await waitFor(
      async () => (await count('[data-testid="compare.waveform.note"]')) === 1,
      "the differing-window note never appeared",
    );

    await browser.tauri.switchWindow(same);
    await waitForShell();
    await closeCurrentWindow();
    await browser.tauri.switchWindow("main").catch(() => {});
    await waitFor(async () => !(await windowLabels()).includes(same), `${same} did not close`);
  });
});
