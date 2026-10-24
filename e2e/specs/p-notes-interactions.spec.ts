/**
 * P. Notes — the interaction model (M14 follow-up).
 *
 * Covers what the notes review changed and what the flow spec (`n-notes`) does not:
 * creating a note opens its editor and never moves the analysis window, selecting a note
 * does not either (only **Analyze** does), closing the rail unfocuses and hands the count
 * to the Toolbar, the lane drag creates a range, and a note works on the **matrix** tools
 * (mel spectrogram, MFCC) — the tools where `valuesText` used to throw and lose the note.
 *
 * See `docs/notes.md` and `decisions.md` → ADR-19.
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

/** The first note row / its heading / its editor / its values line. */
const ROW = '[data-testid^="note.row."]';
const HEADING = '[data-testid^="note.heading."]';
const EDITOR = '[data-testid^="note.bodyInput."]';
const VALUES = '[data-testid^="note.values."]';
const ANALYZE = '[data-testid^="note.analyze."]';

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function readout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/** Reveal the Notes rail when it is closed (its open state is app-level). */
async function openRail(): Promise<void> {
  if ((await count(SEL.notesRegion)) === 0) await (await $(SEL.toolbarNotes)).click();
  await (await $(SEL.notesRegion)).waitForExist();
}

/**
 * Drag across the Timeline's **note lane** (the bottom 12 px of the canvas) from one
 * fraction of its width to another, which is how a range note is made.
 */
async function dragLane(fromFrac: number, toFrac: number): Promise<void> {
  await browser.execute(
    (sel: string, from: number, to: number) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!canvas) throw new Error("dragLane: no timeline canvas");
      const rect = canvas.getBoundingClientRect();
      // Inside the lane: the bottom `NOTE_STRIP_H` (12) px of the canvas.
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

describe("P. Notes — interaction model", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // Start from a clean project, so the note counts below are deterministic.
    await newEmptyProject();
  });

  it("P1 — creating opens the editor, keeps the values, and moves nothing", async () => {
    await openFixture("sine440");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    await openRail();

    const before = await readout();
    await (await $(SEL.notesAdd)).click();
    await waitFor(async () => (await count(ROW)) === 1, "the note row never appeared");

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
    expect(await count(".note-row-focused")).toBe(1);
  });

  it("P2 — Analyze moves the analysis window onto the note", async () => {
    // A range drawn in the Timeline lane, well away from 0, so the window must move.
    await dragLane(0.55, 0.7);
    await waitFor(async () => (await count(ROW)) === 2, "the range note was never created");

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

  it("P3 — closing the rail unfocuses and the Toolbar carries the count", async () => {
    await (await $$(HEADING))[0].click();
    await waitFor(async () => (await count(".note-row-focused")) === 1, "the note never focused");

    await (await $(SEL.notesCollapse)).click();
    await waitFor(async () => (await count(SEL.notesRegion)) === 0, "the rail never closed");

    // No rail, no focus — and the charts' overlay goes with it.
    expect(await count(".note-row-focused")).toBe(0);
    // The count lives *inside* the Toolbar button while the rail is closed.
    const badge = await $(SEL.toolbarNotesCount);
    await badge.waitForExist();
    expect((await badge.getText()).trim()).toBe("2");
  });

  it("P4 — a note works on a matrix tool (mel spectrogram)", async () => {
    // Regression: a `MatrixResult` carries `times` as well as `bins`/`values`, so the
    // values formatter took the series branch, called a missing `formatY`, threw inside
    // `createNote` and dropped the note — on every matrix tool.
    await openRail();
    await openTool("melSpectrogram");
    await waitForAnalyzer("melSpectrogram");

    // Earlier cases left notes behind, so count the delta rather than expecting one row.
    const before = await count(ROW);
    await (await $(SEL.notesAdd)).click();
    await waitFor(async () => (await count(ROW)) === before + 1, "the mel note was never created");

    // A real frozen snapshot, not a lost note: every values line, and one names the band.
    const texts = await $$(VALUES);
    const lines: string[] = [];
    for (const line of texts) lines.push((await line.getText()).trim());
    expect(lines.some((text) => text.includes("mel band"))).toBe(true);
    expect(await count(`${analyzerPanel("melSpectrogram")} canvas`)).toBeGreaterThan(0);
  });
});
