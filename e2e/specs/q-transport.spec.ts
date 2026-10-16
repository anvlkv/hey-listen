/**
 * Q. Preview transport (M14 follow-up).
 *
 * The Timeline's transport: the **varispeed slider** (a log scale with 1× at the centre),
 * the **playhead** drawn on the open charts while auditioning, the **note-at-the-playhead**
 * action, and the Timeline's **scrollbar** when the view is zoomed in.
 *
 * Audio itself cannot be heard headlessly, and WebKit suspends `requestAnimationFrame`
 * (and throttles timers) for the window WebDriver drives, so the transport advances in
 * coarse steps here. What is asserted is therefore what the transport *drives* — the
 * slider's scale, the rule appearing on an open chart, the note landing at the
 * transport's position, and the scrollbar — not frame-by-frame smoothness.
 */
import { SEL, analyzerPanel } from "../support/selectors.ts";
import {
  canvasHasInk,
  closeAllTabs,
  closeTool,
  count,
  dragTimelineHandle,
  menuAction,
  mockReturn,
  openFixture,
  openTool,
  rowSignature,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  wheelOver,
} from "../support/helpers.ts";

const ROW = '[data-testid^="note.row."]';
const SPEED_VALUE = '[data-testid="timeline.speed.value"]';

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function readout(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/** Set the transport speed with a keyboard gesture on the slider (its thumb moves focus). */
async function pressSpeedKey(key: string): Promise<void> {
  // Kobalte's range input is hidden; its thumb is the focusable control (as in A3).
  await (await $(".timeline-speed .gain-thumb")).click();
  await browser.keys(key);
  await browser.pause(120);
}

/** The transport's speed readout, e.g. `1×`. */
async function speedReadout(): Promise<string> {
  return (await $(SPEED_VALUE)).getText().then((text) => text.trim());
}

/**
 * `true` while the transport is playing. The note-at-the-playhead action is enabled only
 * then, so it doubles as the transport's state readout.
 */
async function transportPlaying(): Promise<boolean> {
  return (await $(SEL.timelineNoteAtCursor)).isEnabled();
}

/** Stop the transport if it is running, so each case starts from a known state. */
async function stopTransport(): Promise<void> {
  if (await transportPlaying()) await (await $(SEL.timelinePreview)).click();
  await waitFor(async () => !(await transportPlaying()), "the preview never stopped");
}

/**
 * Start the transport and check that `chart` shows the playhead, retrying: opening the
 * audio device can fail transiently in a headless environment, which (correctly) stops the
 * transport and erases the rule.
 */
async function playheadOnChart(chart: string, idle: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await transportPlaying())) {
      await (await $(SEL.timelinePreview)).click();
      // Let the transport report playing and paint once before comparing.
      await waitFor(async () => await transportPlaying(), "the transport never started");
      await browser.pause(500);
    }
    if ((await rowSignature(chart)) !== idle) return true;
  }
  return false;
}

describe("Q. Preview transport", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await mockReturn("confirm", true);
    await menuAction("new");
  });

  it("Q1 — the speed slider is logarithmic, with 1× at the centre", async () => {
    await openFixture("sine440");
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline never rendered");

    // 1× is the centre of the track: 0.25× … 4× either side.
    expect(await speedReadout()).toBe("1×");

    // Ten steps out is 4^(0.10) ≈ 1.15× — a *linear* track would read 1.10×.
    for (let i = 0; i < 10; i++) await pressSpeedKey("ArrowRight");
    expect(await speedReadout()).toBe("1.15×");

    // Back to real time, so the rest of the suite previews at 1×.
    for (let i = 0; i < 10; i++) await pressSpeedKey("ArrowLeft");
    expect(await speedReadout()).toBe("1×");
  });

  it("Q2 — the playhead appears on a uPlot chart while previewing", async () => {
    await stopTransport();
    // Nothing is playing, so the note-at-the-playhead action is unavailable.
    expect(await transportPlaying()).toBe(false);

    await openTool("waveform");
    await waitForAnalyzer("waveform");
    const chart = `${analyzerPanel("waveform")} canvas`;

    // Starting the transport publishes its position, so the rule lands on the chart...
    const idle = await rowSignature(chart);
    expect(await playheadOnChart(chart, idle)).toBe(true);

    // ...and stopping erases it, leaving the chart as it was.
    await stopTransport();
    await waitFor(
      async () => (await rowSignature(chart)) === idle,
      "the playhead stayed on the chart after the transport stopped",
    );
    await closeTool("waveform");
  });

  it("Q5 — the playhead appears on a canvas heatmap while previewing", async () => {
    await stopTransport();
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");
    const chart = `${analyzerPanel("spectrogram")} canvas`;

    const idle = await rowSignature(chart);
    expect(await playheadOnChart(chart, idle)).toBe(true);
    await stopTransport();
    await waitFor(
      async () => (await rowSignature(chart)) === idle,
      "the playhead stayed on the heatmap after the transport stopped",
    );
    await closeTool("spectrogram");
  });

  it("Q3 — a note can be dropped at the playhead", async () => {
    await stopTransport();

    // Move the analysis window so it does *not* start at the source start: a note placed
    // at the transport's position must then land inside the window, not at 0.
    await dragTimelineHandle("start", 140);
    const moved = await readout();
    expect(moved.startsWith("0:00.00")).toBe(false);

    await (await $(SEL.timelinePreview)).click();
    await waitFor(async () => await transportPlaying(), "the transport never started the preview");
    await (await $(SEL.timelineNoteAtCursor)).click();
    await waitFor(async () => (await count(ROW)) === 1, "no note appeared at the playhead");

    // The transport's position is where the window starts, so the note is there — proof it
    // was placed at the playhead rather than at the source start.
    const meta = (await browser.execute(
      () => document.querySelector(".note-row-meta")?.textContent?.trim() ?? "",
    )) as string;
    expect(meta).toMatch(/[0-9]/);
    expect(meta).not.toContain("0.000 s");

    await stopTransport();
  });

  it("Q4 — the Timeline grows a scrollbar when zoomed in", async () => {
    // Zoom the *view* (wheel on the waveform) without touching the analysis window.
    await wheelOver(SEL.timelineCanvas, -240);

    await waitFor(
      async () => (await count(SEL.timelineScrollThumb)) > 0,
      "the Timeline never showed a scroll thumb when zoomed in",
    );
    expect(await count(SEL.timelineScroll)).toBe(1);
  });
});
