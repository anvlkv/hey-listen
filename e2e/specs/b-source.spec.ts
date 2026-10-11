/**
 * B. Source kinds (M8) — matrix rows B1–B4 (`docs/testing.md`).
 *
 * One app window per project: a source loaded in one test persists to the next, so
 * opening another one replaces the whole timeline (the core confirms first). The
 * live-capture happy path (B5) needs a signed bundle and a real permission grant,
 * so it is a documented manual smoke and `skip`ped here.
 */
import { SEL } from "../support/selectors.ts";
import {
  waitForApp,
  waitFor,
  openTool,
  openFixture,
  ensureSourcePanel,
  openSelect,
  pickOption,
  mockReturn,
  mockReject,
  canvasHasInk,
  click,
  count,
  textOf,
} from "../support/helpers.ts";

/** The Timeline toolbar's window readout (e.g. `0:00.00 – 0:02.00 Δ …`). */
async function timelineReadout(): Promise<string> {
  return (await browser.execute(() =>
    document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

describe("B. Source kinds", () => {
  before(async () => {
    await waitForApp();
    // Replacing the current source asks the core to confirm; allow it in tests.
    await mockReturn("confirm", true);
  });

  it("B1 — a file source renders on the timeline", async () => {
    await openFixture("sine440");
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline waveform never rendered");
    // A fresh file defaults the window to the whole source (2 s).
    expect(await timelineReadout()).toContain("0:02");
  });

  it("B2 — a synth source renders from its PCM", async () => {
    await openTool("synth");
    await click(SEL.graphRender);
    // The default sine→output graph renders 4 s; the readout confirms it replaced
    // the file source, and the timeline still draws the new PCM.
    await waitFor(
      async () => (await timelineReadout()).includes("0:04"),
      "the synth PCM never landed on the timeline",
    );
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline waveform never rendered");
  });

  it("B3 — opening a file then a synth keeps exactly one source", async () => {
    // After B2 a (synth) source exists, so the Source panel is hidden; reveal it
    // to reach the file picker again.
    await ensureSourcePanel();

    await openFixture("sine440");
    await waitFor(
      async () => (await timelineReadout()).includes("0:02"),
      "the file source did not load",
    );

    // Render the default synth, replacing the file (one source per project).
    await openTool("synth");
    await click(SEL.graphRender);
    await waitFor(
      async () => (await timelineReadout()).includes("0:04"),
      "the synth source did not replace the file source",
    );

    expect(await count(SEL.timeline)).toBe(1);
    await waitFor(() => canvasHasInk(SEL.timelineCanvas), "the timeline waveform never rendered");
  });

  it("B4 — a failed capture surfaces an error, not silence", async () => {
    // Force the capture start to reject, then choose the Microphone kind.
    await mockReject("start_capture", "capture permission denied");

    // The Source panel may be hidden once a source exists; reveal it if needed.
    await ensureSourcePanel();

    await openSelect('[data-testid="source.kind"]');
    await pickOption("Microphone");

    await waitFor(
      async () => (await textOf(SEL.sourceError)).trim().length > 0,
      "the capture error did not surface",
    );
  });

  // B5 — Live capture (Manual): with an OS permission grant, record from a
  // mic/system source and verify the input meter is live, the timeline grows, and
  // pause/resume work. macOS only prompts for a bundled + signed app, so CI cannot
  // drive it; see `docs/testing.md` → B5 and `docs/source-model.md` (OS permissions).
  describe.skip("B5 — live capture (manual, not run in CI)", () => {
    it("records with a grant: live meter, growing timeline, pause/resume", async () => {
      // Documented manual steps — see docs/testing.md row B5.
    });
  });
});
