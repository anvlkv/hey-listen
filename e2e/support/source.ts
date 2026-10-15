/**
 * Source & fixtures (M8): reveal the Source panel, open a file (with the native
 * picker mocked), and wait for the swap to land on the Timeline.
 */
import { SEL } from "./selectors.ts";
import { FIXTURES } from "./fixtures.ts";
import { click, count, waitForSelector } from "./dom.ts";
import { mockReturn } from "./ipc.ts";
import { openSelect, pickOption } from "./popups.ts";

/** The Timeline window readout text (e.g. `0:00.00 – 0:02.00 …`). */
export async function timelineReadoutText(): Promise<string> {
  return (await browser.execute(
    () => document.querySelector(".timeline-readout")?.textContent?.trim() ?? "",
  )) as string;
}

/**
 * Make the Source panel reachable: once a source exists the panel is hidden behind
 * the Timeline's *Replace…* button, so click it when the panel is absent.
 */
export async function ensureSourcePanel(): Promise<void> {
  if ((await count(SEL.source)) > 0) return;
  if ((await count(SEL.timelineReplace)) > 0) await click(SEL.timelineReplace);
  await browser.waitUntil(async () => (await count(SEL.source)) > 0, {
    timeoutMsg: "the source panel did not open",
  });
}

/** Open a file source by mocking the native picker, then clicking *Open*. */
export async function openFileFixture(path: string): Promise<void> {
  await ensureSourcePanel();
  // A prior test may have switched the kind (e.g. B4 selects Microphone); make the
  // file kind active so the "Open audio file…" button exists.
  await openSelect('[data-testid="source.kind"]');
  await pickOption("Audio file");
  await mockReturn("pick_audio_file", path);
  await waitForSelector(SEL.sourceOpenFile, "the file picker button did not appear");
  await click(SEL.sourceOpenFile);
}

/** Wait until a source is on the timeline (the Timeline region replaced the strip). */
export async function waitForSourceLoaded(timeout = 30_000): Promise<void> {
  await browser.waitUntil(async () => (await count(SEL.timeline)) > 0, {
    timeout,
    timeoutMsg: "the timeline never replaced the source strip (no source loaded?)",
  });
}

/** The known duration (seconds) of each fixture — used to confirm a source swapped. */
const FIXTURE_SECONDS: Record<keyof typeof FIXTURES, number> = {
  sine440: 2,
  chirpNoise: 3,
  stereo: 2.5,
  corrupt: 0,
  synthGraph: 0,
};

/**
 * Open one of the generated fixtures and wait for the **new** source to land. The
 * core prompts before replacing an existing source, so the confirm is auto-answered.
 * If a fixture of the same duration is already loaded (the app is one long-lived
 * instance across the whole run), the load is skipped.
 */
export async function openFixture(name: keyof typeof FIXTURES): Promise<void> {
  const seconds = FIXTURE_SECONDS[name];
  const clock = `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
  const before = await timelineReadoutText();
  if (before && seconds > 0 && before.includes(clock)) return; // already loaded

  await ensureSourcePanel();
  await mockReturn("confirm", true);
  await openFileFixture(FIXTURES[name]);
  await waitForSourceLoaded();
  if (seconds > 0) {
    await browser.waitUntil(async () => (await timelineReadoutText()).includes(clock), {
      timeoutMsg: `the timeline never showed the ${name} duration (${clock})`,
    });
  }
}
