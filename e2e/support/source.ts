/**
 * Source & fixtures (M8): reveal the Source panel, open a file (with the native
 * picker mocked), and wait for the swap to land on the Timeline.
 */
import { SEL, activityTab } from "./selectors.ts";
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
 * Show the Sources rail: the activity bar's pinned Sources tab (M43). A no-op when the
 * rail already shows it. Revealing it never collapses the rail.
 */
export async function showSources(): Promise<void> {
  if ((await count(SEL.source)) > 0) return;
  await click(activityTab("sources"));
  await waitForSelector(SEL.source, "the Sources rail did not open");
}

/**
 * Make the Sources rail reachable. It lives in the Sidebar (M43), so reveal it from the
 * Timeline's *Replace* button when a source exists, else select its activity tab.
 */
export async function ensureSourcePanel(): Promise<void> {
  if ((await count(SEL.source)) > 0) return;
  if ((await count(SEL.timelineReplace)) > 0) await click(SEL.timelineReplace);
  else await click(activityTab("sources"));
  await browser.waitUntil(async () => (await count(SEL.source)) > 0, {
    timeoutMsg: "the Sources rail did not open",
  });
}

/**
 * Reveal the Source panel and make the *file* kind active, so its picker button exists.
 *
 * A fresh window starts on the file kind, but an earlier test in the same app session may
 * have switched it (e.g. to Microphone), so every file open goes through here.
 */
export async function prepareFilePicker(): Promise<void> {
  await ensureSourcePanel();
  await openSelect('[data-testid="source.kind"]');
  await pickOption("Audio file");
  await waitForSelector(SEL.sourceOpenFile, "the file picker button did not appear");
}

/** Open a file source by mocking the native picker, then clicking *Open*. */
export async function openFileFixture(path: string): Promise<void> {
  await prepareFilePicker();
  await mockReturn("pick_audio_file", path);
  await click(SEL.sourceOpenFile);
  // The post-pick chooser stands between the picker and the load. Pin the suite's baseline
  // (`embedded`) instead of whatever this machine remembered from an earlier run.
  await waitForSelector(SEL.storageDialog, "the storage chooser did not open");
  await click(SEL.storageDialogEmbedded);
  await click(SEL.storageDialogOpen);
}

/** Wait until the Timeline reports a settled source (M43 keeps it mounted always). */
export async function waitForSourceLoaded(timeout = 30_000): Promise<void> {
  await browser.waitUntil(async () => (await count(SEL.timelineEmpty)) === 0, {
    timeout,
    timeoutMsg: "the timeline never became active (no source loaded?)",
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
 * Show the Sources rail and choose the **Synth** kind, so its render controls exist.
 *
 * The synth graph tab is a pure editor (M43): Length, Render and Live live in Sources and
 * are shown for the chosen kind, so a script that renders the synth must select it here.
 */
export async function prepareSynthSource(): Promise<void> {
  await showSources();
  if ((await count(SEL.graphRender)) === 0) {
    await openSelect('[data-testid="source.kind"]');
    await pickOption("Synth (graph)");
  }
  await waitForSelector(SEL.graphRender, "the synth render controls did not appear");
}

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
  // Only an **active** timeline means a source is loaded: a failed open clears the source
  // but leaves the last window in the readout, so the readout alone would skip the reload.
  const active = (await count(SEL.timelineEmpty)) === 0;
  if (active && before && seconds > 0 && before.includes(clock)) return; // already loaded

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
