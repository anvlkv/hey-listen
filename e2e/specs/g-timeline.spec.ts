/**
 * G. Timeline (M8) — matrix rows G1–G5 (`docs/testing.md`).
 *
 * The waveform window (start/end handles + move bar) is drawn on the Timeline
 * canvas, not the DOM, so G1 addresses the end handle by its known canvas position
 * (`PLOT_PAD` inside the plotted region → `src/components/Timeline.tsx`) and
 * dispatches Pointer Events directly (W3C actions don't reliably reach the WebView).
 * No audio playback is asserted (headless CI has none).
 */
import { SEL, analyzerPanel } from "../support/selectors.ts";
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
  click,
  mockReturn,
  textOf,
  wheelOver,
  dragTimelineHandle,
  startInvokeCounts,
  takeInvokeCounts,
} from "../support/helpers.ts";

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function timelineReadout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/** The seconds a chart's zoom readout spans (`"0.500 – 1.750 s"` → `1.25`). */
function readoutSpan(label: string): number {
  const match = label.match(/([\d.]+) – ([\d.]+)/);
  return match ? Number(match[2]) - Number(match[1]) : Number.NaN;
}

describe("G. Timeline", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    // Install the stubbed dialogs (file picker / confirm) here rather than inheriting
    // them from whichever spec file happens to run first, so this suite also stands alone.
    await mockReturn("confirm", true);
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
    await wheelOver(SEL.timelineCanvas, -240);

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

  it("G4 — moving the window re-fits an open chart instead of leaving a stale view", async () => {
    // Regression: a heatmap kept the range it was showing and merely *clamped* it into the
    // new extent, so after the window moved it showed a hairline (or nothing) until the
    // user zoomed or dragged. The chart must re-fit to the whole new window.
    await openFixture("sine440");
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");

    const chart = analyzerPanel("spectrogram");
    const readout = () => textOf(`${chart} .zoom-readout`);
    const span = async () => readoutSpan(await readout());
    const fit = `${chart} [aria-label="Fit to the whole window"]`;

    await waitFor(async () => (await span()) > 0, "the spectrogram showed no zoom readout");
    const full = await span();

    // Zoom well in, so the view is clearly a sub-range of the analysis window.
    for (let i = 0; i < 3; i++) await wheelOver(`${chart} canvas`, -240);
    await waitFor(async () => (await span()) < full, "the spectrogram never zoomed in");
    const zoomed = await span();

    // Move the analysis window: the chart must re-fit, not keep the stale zoom.
    await dragTimelineHandle("start", 140);
    await waitFor(
      async () => (await span()) > zoomed,
      "the chart kept the stale view after the window moved",
    );

    // What it shows is the whole *new* window — the same range the Fit control gives.
    const refit = await span();
    await click(fit);
    await waitFor(
      async () => Math.abs((await span()) - refit) < 0.002,
      "Fit disagrees with the re-fit after the window moved",
    );
  });

  it("G5 — a window drag coalesces its cross-window pushes", async () => {
    // Regression: every pointermove pushed the shared UI state (the window, the view…)
    // and the core broadcast each push to the project's other windows, whose handlers
    // re-ran effects and repainted. At pointer rate that queued cross-window work faster
    // than it drained, so dragging the window with a popout open stopped responding.
    await openFixture("sine440");
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");

    const before = await timelineReadout();
    await startInvokeCounts();
    // One gesture, twenty moves — a fast drag.
    await dragTimelineHandle("end", -160, 20);
    const counts = await takeInvokeCounts();

    // The gesture did move the window (so the drag was real) …
    await waitFor(async () => (await timelineReadout()) !== before, "the window never moved");
    // … it did push the new window to the project's other windows …
    expect(counts.set_ui_state ?? 0).toBeGreaterThan(0);
    // … but not once per move: each push is a broadcast every other window acts on.
    expect(counts.set_ui_state ?? 0).toBeLessThanOrEqual(6);
  });
});
