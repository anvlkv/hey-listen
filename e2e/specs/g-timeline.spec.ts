/**
 * G. Timeline (M8) — matrix rows G1–G3 (`docs/testing.md`).
 *
 * The waveform window (start/end handles + move bar) is drawn on the Timeline
 * canvas, not the DOM, so G1 addresses the end handle by its known canvas position
 * (`PLOT_PAD` inside the plotted region → `src/components/Timeline.tsx`) and
 * dispatches Pointer Events directly (W3C actions don't reliably reach the WebView).
 * No audio playback is asserted (headless CI has none).
 */
import { SEL } from "../support/selectors.ts";
import {
  waitForApp,
  waitFor,
  openTool,
  openFixture,
  openSelect,
  pickOption,
  canvasHasInk,
  waitForAnalyzer,
  closeAllTabs,
} from "../support/helpers.ts";

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function timelineReadout(): Promise<string> {
  return (await browser.execute(() =>
    document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/**
 * Drag a Timeline window handle. The handles are drawn on the canvas at
 * `PLOT_PAD` inside the plot, so we target them by position rather than a selector.
 */
async function dragTimelineHandle(which: "start" | "end", dx: number): Promise<void> {
  await browser.execute(
    (sel: string, side: string, offset: number) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!canvas) throw new Error("no timeline canvas");
      const PLOT_PAD = 12; // mirrors `src/components/Timeline.tsx`
      const rect = canvas.getBoundingClientRect();
      const x = side === "start" ? rect.left + PLOT_PAD : rect.right - PLOT_PAD;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, cx: number, cy: number, buttons: number) => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: cy,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons,
          }),
        );
      };
      fire("pointerdown", x, y, 1);
      fire("pointermove", x + offset, y, 1);
      fire("pointerup", x + offset, y, 0);
    },
    SEL.timelineCanvas,
    which,
    dx,
  );
}

describe("G. Timeline", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
  });

  it("G1 — dragging the window handle settles the window and re-runs analysis", async () => {
    await openFixture("sine440");
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline never rendered");

    const before = await timelineReadout();
    // Narrow the analysis window by dragging the end handle inward.
    await dragTimelineHandle("end", -120);
    await waitFor(
      async () => (await timelineReadout()) !== before,
      "the analysis window did not change after dragging the handle",
    );

    // The timeline still renders, and the waveform analyzer re-runs on the new window.
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline stopped rendering");
    await openTool("waveform");
    await waitForAnalyzer("waveform");
  });

  it("G2 — zooming keeps the waveform rendering", async () => {
    await openFixture("sine440");
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline never rendered");

    // A synthetic wheel event at the canvas centre drives the Timeline's zoom.
    await browser.execute((sel: string) => {
      const c = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      c.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -240,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, SEL.timelineCanvas);

    await waitFor(
      () => canvasHasInk(SEL.timelineCanvas),
      "the waveform stopped rendering after zooming",
    );
  });

  it("G3 — switching the analysis channel on a stereo source still renders", async () => {
    await openFixture("stereo");
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline never rendered");

    await openSelect(SEL.channelSelect);
    await pickOption("Right");

    await openTool("waveform");
    await waitForAnalyzer("waveform");
  });
});
