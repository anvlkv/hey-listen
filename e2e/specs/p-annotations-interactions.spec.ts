/**
 * P. Annotations — the interaction model (M14 follow-up).
 *
 * Covers what the annotations review changed and what the flow spec (`n-annotations`) does not:
 * creating an annotation opens its editor and never moves the analysis window, selecting
 * one does not either (only **Analyze** does), closing the rail clears the selection and
 * hands the count to the Toolbar, the lane drag creates a range, and an annotation works
 * on the **matrix** tools (mel spectrogram, MFCC) — the tools where `valuesText` used to
 * throw and lose it.
 *
 * See `docs/annotations.md` and `decisions.md` → ADR-19.
 */
import { SEL, analyzerPanel } from "../support/selectors.ts";
import {
  closeAllTabs,
  count,
  newEmptyProject,
  openFixture,
  openTool,
  waitFor,
  waitForAnalyzer,
  waitForApp,
} from "../support/helpers.ts";

/** The first annotation row / its heading / its editor / its values line. */
const ROW = '[data-testid^="annotation.row."]';
const HEADING = '[data-testid^="annotation.heading."]';
const EDITOR = '[data-testid^="annotation.bodyInput."]';
const VALUES = '[data-testid^="annotation.values."]';
const ANALYZE = '[data-testid^="annotation.analyze."]';

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function readout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/** Reveal the Annotations rail when it is closed (its open state is app-level). */
async function openRail(): Promise<void> {
  if ((await count(SEL.annotationsRegion)) === 0) await (await $(SEL.toolbarAnnotations)).click();
  await (await $(SEL.annotationsRegion)).waitForExist();
}

/**
 * Drag across the Timeline's **annotation lane** (the bottom 12 px of the canvas) from one
 * fraction of its width to another, which is how a range annotation is made.
 */
async function dragLane(fromFrac: number, toFrac: number): Promise<void> {
  await browser.execute(
    (sel: string, from: number, to: number) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!canvas) throw new Error("dragLane: no timeline canvas");
      const rect = canvas.getBoundingClientRect();
      // Inside the lane: the bottom `ANNOTATION_STRIP_H` (12) px of the canvas.
      const y = rect.top + rect.height - 6;
      const x0 = rect.left + rect.width * from;
      const x1 = rect.left + rect.width * to;
      const fire = (type: string, x: number, buttons: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons,
          }),
        );
      fire("pointerdown", x0, 1);
      fire("pointermove", x1, 1);
      fire("pointerup", x1, 0);
    },
    SEL.timelineCanvas,
    fromFrac,
    toFrac,
  );
}

describe("P. Annotations — interaction model", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // Start from a clean project, so the annotation counts below are deterministic.
    await newEmptyProject();
  });

  it("P1 — creating opens the editor, keeps the values, and moves nothing", async () => {
    await openFixture("sine440");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    await openRail();

    const before = await readout();
    await (await $(SEL.annotationsAdd)).click();
    await waitFor(async () => (await count(ROW)) === 1, "the annotation row never appeared");

    // The editor replaces the *body*, not the values: the frozen readout stays visible.
    expect(await count(EDITOR)).toBe(1);
    expect(await count(VALUES)).toBe(1);
    // Adding an annotation is not a request to reframe the analysis.
    expect(await readout()).toBe(before);

    // Selecting it (the heading) does not reframe either. Note the prefix selectors can
    // match several rows once a case has added more than one, so index explicitly.
    await (await $$(HEADING))[0].click();
    await browser.pause(300);
    expect(await readout()).toBe(before);
    expect(await count(".annotation-row-selected")).toBe(1);
  });

  it("P2 — Analyze moves the analysis window onto the annotation", async () => {
    // A range drawn in the Timeline lane, well away from 0, so the window must move.
    await dragLane(0.55, 0.7);
    await waitFor(async () => (await count(ROW)) === 2, "the range annotation was never created");

    const before = await readout();
    const buttons = await $$(ANALYZE);
    await buttons[buttons.length - 1].click();

    await waitFor(
      async () => (await readout()) !== before,
      "Analyze did not move the analysis window",
    );
    // The window now starts where the range does, not at the source start.
    expect((await readout()).startsWith("0:00.00")).toBe(false);
  });

  it("P3 — closing the rail clears the selection and the Toolbar carries the count", async () => {
    await (await $$(HEADING))[0].click();
    await waitFor(
      async () => (await count(".annotation-row-selected")) === 1,
      "the annotation was never selected",
    );

    await (await $(SEL.annotationsCollapse)).click();
    await waitFor(async () => (await count(SEL.annotationsRegion)) === 0, "the rail never closed");

    // No rail, no selection — and the charts' overlay goes with it.
    expect(await count(".annotation-row-selected")).toBe(0);
    // The count lives *inside* the Toolbar button while the rail is closed.
    const badge = await $(SEL.toolbarAnnotationsCount);
    await badge.waitForExist();
    expect((await badge.getText()).trim()).toBe("2");
  });

  it("P4 — an annotation works on a matrix tool (mel spectrogram)", async () => {
    // Regression: a `MatrixResult` carries `times` as well as `bins`/`values`, so the
    // values formatter took the series branch, called a missing `formatY`, threw inside
    // `createAnnotation` and dropped the annotation — on every matrix tool.
    await openRail();
    await openTool("melSpectrogram");
    await waitForAnalyzer("melSpectrogram");

    // Earlier cases left annotations behind, so count the delta rather than expecting one row.
    const before = await count(ROW);
    await (await $(SEL.annotationsAdd)).click();
    await waitFor(
      async () => (await count(ROW)) === before + 1,
      "the mel annotation was never created",
    );

    // A real frozen snapshot, not a lost annotation: every values line, and one names the band.
    const texts = await $$(VALUES);
    const lines: string[] = [];
    for (const line of texts) lines.push((await line.getText()).trim());
    expect(lines.some((text) => text.includes("mel band"))).toBe(true);
    expect(await count(`${analyzerPanel("melSpectrogram")} canvas`)).toBeGreaterThan(0);
  });
});
