/**
 * Q2. Synth workflow (M22): the Live in-place source write and the palette drag
 * affordance.
 *
 * Live runs for real, so the source PCM and the preserved UI state are observed end to
 * end. Playback is the Timeline's transport; the synth tab adds no second play control.
 * The spec sorts before `t-close-main`, which must stay last.
 */
import { expectLogErrors } from "../support/logs.ts";
import { firstAnnotationRow, SEL } from "../support/selectors.ts";
import {
  waitForApp,
  waitFor,
  count,
  textOf,
  click,
  openTool,
  openFixture,
  waitForSourceLoaded,
  timelineReadoutText,
  startInvokeCounts,
  takeInvokeCounts,
  mockReject,
  restoreMocks,
} from "../support/helpers.ts";
import {
  beginPaletteDrag,
  canvasPoint,
  clearFilterGraph,
  filterHint,
  nodeCentre,
  paletteDragCancel,
  paletteDragRelease,
  paletteDragTo,
  seedEdgeMidpoint,
} from "../support/graph.ts";
import { closeWindowPopover, setInputValue } from "../support/timelinePrecision.ts";
import { pressChord } from "../support/keys.ts";
import { quietSynthLive } from "../support/synth.ts";

// Q2.2 forces a rejected live render; the IPC façade logs exactly that line.
expectLogErrors("update_synth_source failed: synth rejected by test");

/** The Timeline scrollbar thumb's client box, or null when the whole source fits. */
async function thumbBox(): Promise<{ left: number; width: number } | null> {
  return (await browser.execute((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  }, SEL.timelineScrollThumb)) as { left: number; width: number } | null;
}

describe("Q2. Synth workflow", () => {
  before(async () => {
    await waitForApp();
  });

  afterEach(async () => {
    await restoreMocks();
    await paletteDragCancel();
    await quietSynthLive();
  });

  it("Q2.1 — Live overwrites the source without resetting the window, view or annotations", async () => {
    await openFixture("sine440");
    await openTool("synth");
    await waitFor(async () => (await count(SEL.graphRender)) > 0, "the synth tab did not open");
    // Live is persisted chrome: start from off so the click below turns it *on*.
    await quietSynthLive();

    // Make the synth the source once, so Live takes the in-place path (no adoption reset).
    await click(SEL.graphRender);
    await waitForSourceLoaded();
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:04"),
      "the 4 s synth render never became the timeline source",
    );

    // A sub-window, a zoomed view and at least one annotation: the state Live must keep.
    await click(SEL.timelineWindowEdit);
    await waitFor(async () => (await count(SEL.windowStart)) > 0, "the window fields did not open");
    await setInputValue(SEL.windowStart, "0:00.50");
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:00.50"),
      "the window start did not commit",
    );
    await setInputValue(SEL.windowEnd, "0:01.50");
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:01.50"),
      "the window end did not commit",
    );
    await closeWindowPopover();
    const windowBefore = await timelineReadoutText();

    // Open the rail *before* measuring the view: the rail changes the Timeline width.
    if ((await count(SEL.annotationsRegion)) === 0) await click(SEL.toolbarAnnotations);
    await waitFor(
      async () => (await count(SEL.annotationsRegion)) > 0,
      "the annotations rail did not open",
    );
    if ((await count(firstAnnotationRow)) === 0) await click(SEL.annotationsAdd);
    await waitFor(
      async () => (await count(firstAnnotationRow)) === 1,
      "the annotation did not appear",
    );
    const annotationBefore = await textOf(firstAnnotationRow);
    const annotationsBefore = await count(firstAnnotationRow);

    await pressChord("="); // zoom in, so the view is narrower than the source
    await waitFor(async () => (await count(SEL.timelineScrollThumb)) > 0, "the view did not zoom");
    const thumbBefore = await thumbBox();
    expect(thumbBefore).not.toBeNull();

    // Turn Live on: a real in-place re-render of the same 4 s source.
    let liveRuns = 0;
    await startInvokeCounts();
    await click(SEL.synthLive);
    await waitFor(async () => {
      const counts = await takeInvokeCounts();
      liveRuns += counts.update_synth_source ?? 0;
      return liveRuns > 0;
    }, "Live never called update_synth_source");

    // Exactly what was there before the write.
    expect(await timelineReadoutText()).toBe(windowBefore);
    const thumbAfter = await thumbBox();
    expect(thumbAfter).not.toBeNull();
    expect(Math.abs(thumbAfter!.left - thumbBefore!.left)).toBeLessThan(1.5);
    expect(Math.abs(thumbAfter!.width - thumbBefore!.width)).toBeLessThan(1.5);
    expect(await count(firstAnnotationRow)).toBe(annotationsBefore);
    expect(await textOf(firstAnnotationRow)).toBe(annotationBefore);
    expect(await count(SEL.graphError)).toBe(0);
  });

  it("Q2.2 — a failed live render keeps the last good audio", async () => {
    await openTool("synth");
    await waitFor(async () => (await count(SEL.synthLive)) > 0, "the synth tab did not open");
    // As above: off, so the click turns Live on and the rejection is this case's.
    await quietSynthLive();
    const before = await timelineReadoutText();
    const sourceBefore = (await browser.execute(
      () => document.querySelector(".timeline-position")?.textContent?.trim() ?? "",
    )) as string;

    await mockReject("update_synth_source", "synth rejected by test");
    await click(SEL.synthLive);
    await waitFor(
      async () => (await count(SEL.graphError)) > 0,
      "the rejected live render did not report inline",
    );
    expect((await textOf(SEL.graphError)).trim()).toContain("synth rejected by test");

    // The previous source is untouched: same window and source duration.
    expect(await timelineReadoutText()).toBe(before);
    const sourceAfter = (await browser.execute(
      () => document.querySelector(".timeline-position")?.textContent?.trim() ?? "",
    )) as string;
    expect(sourceAfter.trim()).toBe(sourceBefore.trim());
  });

  it("Q2.3 — a palette drag shows the ghost/drop preview and drops where it previewed", async () => {
    await openTool("filter");
    await clearFilterGraph();

    // A plain placement: the ghost follows the pointer and the outline shows the landing.
    const drop = await canvasPoint(0.55, 0.8);
    await beginPaletteDrag("gain", "Gain");
    await paletteDragTo(drop.x, drop.y);
    await waitFor(
      async () => (await count(SEL.graphDragGhost)) === 1,
      "the palette drag ghost never appeared",
    );
    await waitFor(
      async () => (await count(SEL.graphDropPreview)) === 1,
      "the drop preview never appeared",
    );
    expect(await count(SEL.graphDropSplice)).toBe(0);
    await paletteDragRelease(drop.x, drop.y);
    await waitFor(
      async () => (await filterHint()).includes("3 nodes"),
      "the dragged node did not land",
    );
    const centre = await nodeCentre("gain");
    expect(centre).not.toBeNull();
    expect(Math.abs(centre!.x - drop.x)).toBeLessThan(60);
    expect(Math.abs(centre!.y - drop.y)).toBeLessThan(60);

    // Over a connector: the splice badge appears, and the drop really splices.
    await clearFilterGraph();
    const mid = await seedEdgeMidpoint();
    await beginPaletteDrag("high-pass", "High-pass");
    await paletteDragTo(mid.x, mid.y);
    await waitFor(
      async () => (await count(SEL.graphDropSplice)) === 1,
      "the splice badge never appeared over the connector",
    );
    await paletteDragRelease(mid.x, mid.y);
    await waitFor(async () => {
      const hint = await filterHint();
      return hint.includes("3 nodes") && hint.includes("2 links");
    }, "the previewed splice did not happen");

    await clearFilterGraph();
  });
});
