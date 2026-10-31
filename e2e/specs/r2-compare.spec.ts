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
  activateTab,
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
  compareToolFromMain,
  compareView,
  openProjectWithFixture,
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
    second = await openProjectWithFixture("chirpNoise");
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

  it("R2.4 — a saved compare tab restores from the reference snapshot", async () => {
    const tmpFile = path.join(os.tmpdir(), `heylisten-e2e-compare-${Date.now()}.heyl`);
    const label = path.basename(tmpFile, ".heyl");

    // The reference project from R2.3 is closed; the last successful result is what the
    // project saves (the same one the banner keeps), so no second window is needed (M25.C).
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await mockReturn("pick_project_save_path", tmpFile);
    await menuActionIn("main", "saveAs");
    await waitFor(() => Promise.resolve(existsSync(tmpFile)), "the project file was never written");

    await mockReturn("pick_project_open_path", tmpFile);
    await menuActionIn("main", "open");
    await waitFor(
      async () => (await textOf(SEL.projectName)).trim() === label,
      "main did not load the saved project",
      30_000,
    );

    // The comparison is project content now: the tab returns, bound to the snapshot, and
    // presents itself as a saved reference (no "reference closed" banner).
    await waitFor(
      async () => (await count(tab(compareTab("spectrum")))) === 1,
      "the saved compare tab was not restored",
    );
    await waitFor(
      async () => (await count('[data-testid="compare.saved"]')) === 1,
      "the saved-reference badge never appeared",
    );
    await waitFor(
      async () => (await count('[data-testid="compare.saved-banner"]')) === 1,
      "the saved-reference banner never appeared",
    );
    expect(await count(BANNER)).toBe(0);
    await waitForCompareChart("spectrum");
    const saved = await invokeCore<{ tool: string; referenceName: string }[]>("compare_saved", {});
    const info = saved.find((entry) => entry.tool === "spectrum");
    expect(info).toBeTruthy();
    expect(info!.referenceName.length).toBeGreaterThan(0);

    // The analyzer tab it was opened from is restored too. The restored compare tab is
    // the active one, and dockview only mounts a **visible** panel — so the analyzer's
    // content exists only once its tab is focused again.
    await waitFor(
      async () => (await count(tab("spectrum"))) > 0,
      "the spectrum tab was not restored",
    );
    await activateTab("spectrum");
    await waitForAnalyzer("spectrum");
  });

  it("R2.13 — reconnecting is explicit and a settled B change marks A dirty", async () => {
    // R2.4 restored a saved comparison; reconnect it to a live project through the picker.
    const reference = await secondProject();
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await changeReference("spectrum", reference);
    await waitFor(
      async () => (await count('[data-testid="compare.saved"]')) === 0,
      "the saved-reference badge stayed after reconnecting",
    );
    await waitForBadge("Aligned");

    // Save so the live binding (and its snapshot) becomes the clean point; the dirty flag
    // must then come from the reference change below, not from the reconnect itself.
    await menuActionIn("main", "save");
    await waitFor(
      async () => !(await textOf(SEL.projectName)).includes("*"),
      "the project stayed dirty after reconnecting and saving",
      15_000,
    );

    // A settled change in the live reference re-runs the comparison; the snapshot would
    // change, so the owner project prompts on close.
    await browser.tauri.switchWindow(reference);
    await waitForShell();
    await invokeCore("set_ui_state", {
      key: "timeline",
      value: { windowStart: 0.5, windowEnd: 2, viewStart: 0.5, viewEnd: 2 },
    });
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await waitFor(
      async () => (await textOf(SEL.projectName)).includes("*"),
      "a settled reference change did not mark the owner dirty",
    );
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
      { tool: "spectrum", with: reference, saved: false },
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
    await compareToolFromMain(tool, reference);
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

    // Leave main on sine440, the source the relative-alignment spec starts from.
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await openFixture("sine440");
  });
});
