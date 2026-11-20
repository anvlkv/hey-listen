/**
 * G2. Timeline precision & accessibility (D-11 / D-12 / D-14).
 *
 * The Timeline's **right-click menu** (set the window from the pointer, restore the whole
 * source, add an annotation there, toggle snapping), **snapping** of a handle drag, the
 * canvas's **keyboard map + live region**, and the **numeric window fields** with the window
 * history behind the toolbar arrows.
 *
 * Every case after the menu smoke test starts from `wholeSource()`, which also frames the view
 * on the whole source: the app instance, the analysis window and the viewport survive from
 * whichever spec ran before (and from the earlier cases here), and `openFixture` skips a
 * reload of a source already loaded. With the window and view known, the pointer geometry —
 * and so the time under a right-click — is deterministic:
 * `((fx · canvasW) − PLOT_PAD) / (canvasW − 2·PLOT_PAD) · Δ` for a mono source whose view
 * starts at 0.
 *
 * Dragging an edge handle auditions an excerpt through the output device, so a runner without
 * one records the transport's two failure lines on purpose; the assertions are all
 * frontend-side (the window, the readout) and do not depend on playback.
 */
import { SEL } from "../support/selectors.ts";
import {
  canvasHasInk,
  click,
  closeAllTabs,
  count,
  dragTimelineHandle,
  mockReturn,
  openFixture,
  textOf,
  waitFor,
  waitForApp,
} from "../support/helpers.ts";
import {
  clickMenuItem,
  closeTimelineMenu,
  closeWindowPopover,
  focusTimeline,
  openTimelineMenu,
  pressOnTimeline,
  setInputValue,
} from "../support/timelinePrecision.ts";

/** `PLOT_PAD` inside the plotted region — mirrors `src/components/Timeline.tsx`. */
const PLOT_PAD = 12;
/** The window history commits on a 350 ms trailing debounce (`state/windowHistory.ts`). */
const HISTORY_SETTLE_MS = 500;
/** A settled window is announced 400 ms after the change (`timeline/accessibility.ts`). */
const ANNOUNCE_SETTLE_MS = 600;
/** The pointer fraction both the window-start and annotation cases right-click at. */
const MENU_FX = 0.5;
/** The end-handle drag both snapping cases replay (identical geometry both times). */
const SNAP_DX = -137;

/** Every `m:ss.ss` in a string, in seconds. */
function timesOf(text: string): number[] {
  const times: number[] = [];
  for (const match of text.matchAll(/(\d+):(\d{2}\.\d{2})/g)) {
    times.push(Number(match[1]) * 60 + Number(match[2]));
  }
  return times;
}

/** The `m:ss.ss – m:ss.ss` analysis window from the Timeline readout, in seconds. */
function timelineWindow(text: string): [number, number] | null {
  const times = timesOf(text);
  return times.length >= 2 ? [times[0], times[1]] : null;
}

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function readout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/** The source duration, from the position readout's `0:00.00 / 0:02.00` tail. */
async function sourceDuration(): Promise<number> {
  const times = timesOf(await textOf(SEL.timelinePosition));
  return times.length > 0 ? times[times.length - 1] : Number.NaN;
}

/** The source time a right-click at canvas fraction `fx` lands on (mono source, view at 0). */
async function pointerTime(fx: number, duration: number): Promise<number> {
  const width = (await browser.execute((sel: string) => {
    return document.querySelector(sel)?.getBoundingClientRect().width ?? 0;
  }, SEL.timelineCanvas)) as number;
  return ((fx * width - PLOT_PAD) / (width - 2 * PLOT_PAD)) * duration;
}

/** Whether a Kobalte checkbox menu item carries `data-checked` (present only while checked). */
async function menuItemChecked(selector: string): Promise<boolean> {
  return (await browser.execute(
    (sel: string) => document.querySelector(sel)?.hasAttribute("data-checked") ?? false,
    selector,
  )) as boolean;
}

/** Whether the toolbar's Previous-window button is enabled (the history has an older entry). */
async function backEnabled(): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const button = document.querySelector(sel) as HTMLButtonElement | null;
    return !!button && !button.disabled;
  }, SEL.timelineWindowBack)) as boolean;
}

/** Restore the whole-source window (and frame the view on it) through the context menu. */
async function wholeSource(): Promise<void> {
  const duration = await sourceDuration();
  await openTimelineMenu();
  await clickMenuItem(SEL.timelineMenuWhole);
  await waitFor(async () => {
    const span = timelineWindow(await readout());
    return span != null && Math.abs(span[0]) < 0.005 && Math.abs(span[1] - duration) < 0.01;
  }, "the window did not return to the whole source");
}

/** Open the mono fixture and reset the window/view to the whole source. */
async function wholeSourceFixture(): Promise<void> {
  await openFixture("sine440");
  await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline never rendered");
  await wholeSource();
}

describe("G2. Timeline precision & accessibility", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // Install the stubbed dialogs here rather than inheriting them from an earlier spec, so
    // this suite also stands alone.
    await mockReturn("confirm", true);
  });

  it("G2.1 — the context menu offers the window, annotation and snap items", async () => {
    await openFixture("sine440");
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline never rendered");

    await openTimelineMenu(0.4);
    expect(await count(SEL.timelineMenu)).toBe(1);
    for (const item of [
      SEL.timelineMenuStart,
      SEL.timelineMenuEnd,
      SEL.timelineMenuAnnotation,
      SEL.timelineMenuWhole,
      SEL.timelineMenuSnap,
    ]) {
      expect(await count(item)).toBe(1);
    }

    await closeTimelineMenu();
    expect(await count(SEL.timelineMenu)).toBe(0);
  });

  it("G2.2 — the window start follows the pointer, then the whole source", async () => {
    await wholeSourceFixture();
    const duration = await sourceDuration();
    expect(duration).toBeGreaterThan(0);

    // The time under the right-click, from the same pointer geometry the app uses.
    const expected = await pointerTime(MENU_FX, duration);
    expect(expected).toBeGreaterThan(0);

    await openTimelineMenu(MENU_FX);
    await clickMenuItem(SEL.timelineMenuStart);
    await waitFor(
      async () => {
        const span = timelineWindow(await readout());
        return span != null && Math.abs(span[0] - expected) < 0.05;
      },
      `the window start did not move to the pointer (≈${expected.toFixed(3)} s)`,
    );

    const moved = timelineWindow(await readout());
    expect(moved).not.toBeNull();
    expect(moved![0]).toBeGreaterThan(0);
    expect(Math.abs(moved![0] - expected)).toBeLessThan(0.05);

    // "Window: whole source" puts the window back on the entire source.
    await wholeSource();
    const restored = timelineWindow(await readout());
    expect(restored).not.toBeNull();
    expect(restored![0]).toBeCloseTo(0, 3);
    expect(restored![1]).toBeCloseTo(duration, 2);
  });

  it("G2.3 — adding an annotation from the menu drops it at the pointer", async () => {
    await wholeSourceFixture();
    const duration = await sourceDuration();
    expect(duration).toBeGreaterThan(0);

    // The rail carries the count and the rows; its open state is app-level, so ask first.
    if ((await count(SEL.annotationsRegion)) === 0) await click(SEL.toolbarAnnotations);
    await waitFor(
      async () => (await count(SEL.annotationsCount)) > 0,
      "the Annotations rail did not open",
    );
    const before = Number((await textOf(SEL.annotationsCount)).trim());

    // Read the pointer's time after the rail is mounted: it narrows the canvas, and the menu
    // records the time from the canvas' *current* box.
    const expected = await pointerTime(MENU_FX, duration);
    await openTimelineMenu(MENU_FX);
    await clickMenuItem(SEL.timelineMenuAnnotation);
    await waitFor(
      async () => Number((await textOf(SEL.annotationsCount)).trim()) === before + 1,
      "no annotation was added from the menu",
    );
    expect(await count(SEL.annotationsRows)).toBe(1);

    // Creating selects the new annotation, so its row is the one the menu item made.
    const meta = (await browser.execute(() => {
      const row = document.querySelector(".annotation-row-selected .annotation-row-meta");
      return row?.textContent?.trim() ?? "";
    })) as string;
    expect(meta).not.toContain("0.000 s");
    const at = meta.match(/(\d+\.\d{3}) s/);
    expect(at).not.toBeNull();
    // Its time is the pointer's time, not the source start or the analysis window.
    expect(Math.abs(Number(at![1]) - expected)).toBeLessThan(0.05);
  });

  it("G2.4 — snapping is off by default and moves a dragged handle once enabled", async () => {
    await wholeSourceFixture();
    const duration = await sourceDuration();
    expect(duration).toBeGreaterThan(0);

    // Snapping is off unless someone switched it on, so the first drag is unassisted.
    await openTimelineMenu();
    expect(await menuItemChecked(SEL.timelineMenuSnap)).toBe(false);
    await closeTimelineMenu();

    // Off (the default): the end handle lands where the pointer left it.
    await dragTimelineHandle("end", SNAP_DX);
    await waitFor(async () => {
      const span = timelineWindow(await readout());
      return span != null && span[1] < duration - 0.01;
    }, "the end handle drag did not move the window");
    const rawEnd = timelineWindow(await readout())![1];

    // The snapped drag must replay the same gesture: same window, same view, same pixels.
    await wholeSource();
    // A checkbox item toggles without closing the menu, so its state is read in place.
    await openTimelineMenu();
    await clickMenuItem(SEL.timelineMenuSnap, false);
    expect(await menuItemChecked(SEL.timelineMenuSnap)).toBe(true);
    await closeTimelineMenu();

    await dragTimelineHandle("end", SNAP_DX);
    const snappedEnd = timelineWindow(await readout())![1];

    // The same pointer position now settles on a ruler-grid line, so it moves — but only to
    // the nearest line, never a visible distance away.
    expect(Math.abs(snappedEnd - rawEnd)).toBeGreaterThan(0.001);
    expect(Math.abs(snappedEnd - rawEnd)).toBeLessThan(0.15);

    // Leave snapping off (and prove the toggle is reversible) for the cases that follow.
    await openTimelineMenu();
    await clickMenuItem(SEL.timelineMenuSnap, false);
    expect(await menuItemChecked(SEL.timelineMenuSnap)).toBe(false);
    await closeTimelineMenu();
  });

  it("G2.5 — the canvas is focusable and its keys move and announce the playhead", async () => {
    await wholeSourceFixture();
    // Let the whole-source window's own announcement land first, so the live region is not
    // overwritten mid-case by the 400 ms window announce that the reset armed.
    await browser.pause(ANNOUNCE_SETTLE_MS);

    const attrs = (await browser.execute((sel: string) => {
      const canvas = document.querySelector(sel);
      return { role: canvas?.getAttribute("role"), tabindex: canvas?.getAttribute("tabindex") };
    }, SEL.timelineCanvas)) as { role: string | null; tabindex: string | null };
    expect(attrs).toEqual({ role: "application", tabindex: "0" });

    await focusTimeline();
    // Start at the source start, so one arrow key is a known step (1% of the whole view).
    await pressOnTimeline("Home");
    await waitFor(
      async () => (await textOf(SEL.timelinePosition)).trim().startsWith("0:00.00"),
      "Home did not return the playhead to the start",
    );

    const atStart = await textOf(SEL.timelinePosition);
    await pressOnTimeline("ArrowRight");
    await waitFor(
      async () => (await textOf(SEL.timelinePosition)) !== atStart,
      "ArrowRight did not move the playhead",
    );
    // The whole source is visible, so the nudge is 1% of it (0.02 s of the 2 s fixture).
    expect((await textOf(SEL.timelinePosition)).trim().startsWith("0:00.02")).toBe(true);
    expect(await textOf(SEL.timelineAnnounce)).toContain("Playhead at");

    await pressOnTimeline("Home");
    await waitFor(
      async () => (await textOf(SEL.timelinePosition)).trim().startsWith("0:00.00"),
      "Home did not move the playhead back to the start",
    );
    expect(await textOf(SEL.timelineAnnounce)).toContain("Playhead at");
  });

  it("G2.6 — the window fields commit and history restores the window", async () => {
    await wholeSourceFixture();
    const duration = await sourceDuration();
    expect(duration).toBeGreaterThan(0);
    // Let the whole-source window settle into the history ring, so the entry Back restores is
    // this one rather than a window from an earlier case.
    await browser.pause(HISTORY_SETTLE_MS);

    await click(SEL.timelineWindowEdit);
    await waitFor(async () => (await count(SEL.windowEnd)) > 0, "the window fields did not open");
    await setInputValue(SEL.windowEnd, "0:01.50");
    await waitFor(async () => {
      const span = timelineWindow(await readout());
      return span != null && Math.abs(span[1] - 1.5) < 0.01;
    }, "the End field did not commit 0:01.50");

    await closeWindowPopover();
    await browser.pause(HISTORY_SETTLE_MS);

    // The ring holds the whole-source window before this edit, so Back undoes it.
    expect(await backEnabled()).toBe(true);
    await click(SEL.timelineWindowBack);
    await waitFor(async () => {
      const span = timelineWindow(await readout());
      return span != null && Math.abs(span[1] - duration) < 0.01;
    }, "the Previous-window arrow did not restore the whole-source window");
  });
});
