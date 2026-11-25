/**
 * S4b. Audio export (M43) — the Export activity tab.
 *
 * Drives the pinned Export rail against the real core: the native save dialog is stubbed
 * with `mockReturn`, and the real `export_audio` command writes the file, so the test
 * reads it back from disk and also asserts the arguments the panel handed the core.
 * Sorts before `s-project-ux` and after the graph specs; `t-close-main` stays last.
 */
import { existsSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { SEL, activityTab } from "../support/selectors.ts";
import {
  click,
  count,
  lastInvokeArgs,
  mockReturn,
  newEmptyProject,
  openFixture,
  openSelect,
  pickOption,
  showSources,
  startInvokeCounts,
  waitFor,
  waitForApp,
} from "../support/helpers.ts";

describe("S4b. Audio export (M43)", () => {
  const target = path.join(os.tmpdir(), `heylisten-e2e-audio-${Date.now()}.wav`);

  /** Open the Export rail without collapsing it when it is already showing. */
  async function showExport(): Promise<void> {
    if ((await count(SEL.exportRegion)) === 0) await click(activityTab("export"));
    await waitFor(async () => (await count(SEL.exportRegion)) > 0, "the Export rail did not open");
  }

  before(async () => {
    await waitForApp();
    await openFixture("stereo");
  });

  after(() => {
    rmSync(target, { force: true });
  });

  it("S4b.1 — the Export tab is reachable from the pinned activity group", async () => {
    await showExport();
    const range = (await (await $(SEL.exportRange)).getText()).trim();
    expect(range).toContain("0.00");
  });

  it("S4b.2 — an export carries the chosen format, depth, channel and filter arguments", async () => {
    await showExport();

    // 16-bit WAV, a single channel (the right one).
    await openSelect(SEL.exportDepth);
    await pickOption("16-bit");
    // The rail seeds the filter switch from the app's own state, and specs share one app
    // instance: a filter composed by an earlier spec would make the picker address graph
    // outputs instead of the source lanes. Turn it off so the labels are deterministic.
    const filterOn = (await browser.execute((sel: string) => {
      const el = document.querySelector(sel);
      return !!el && el.hasAttribute("data-checked");
    }, SEL.exportFilter)) as boolean;
    if (filterOn) await click(SEL.exportFilter);
    await openSelect(SEL.exportChannels);
    await pickOption("Single channel");
    await waitFor(
      async () => (await count(SEL.exportChannel)) > 0,
      "the channel picker did not appear",
    );
    await openSelect(SEL.exportChannel);
    await pickOption("Right");

    await mockReturn("pick_audio_export_path", target);
    await startInvokeCounts();
    await click(SEL.exportRun);

    await waitFor(
      async () => (await count(SEL.exportResult)) > 0,
      "the export never reported a written file",
    );
    expect(existsSync(target)).toBe(true);
    expect(statSync(target).size).toBeGreaterThan(44);

    const args = (await lastInvokeArgs("export_audio")) as {
      args?: Record<string, unknown>;
    } | null;
    expect(args?.args?.format).toBe("wav");
    expect(args?.args?.depth).toBe("i16");
    expect(args?.args?.channels).toBe("single");
    expect(args?.args?.channel).toBe(1);
    expect(args?.args?.applyFilter).toBe(false);
    expect(args?.args?.filter).toBeNull();
    expect(args?.args?.path).toBe(target);
  });

  it("S4b.3 — with no source the export controls are disabled", async () => {
    await newEmptyProject();
    await showExport();
    expect(await (await $(SEL.exportRun)).isEnabled()).toBe(false);
    await waitFor(
      async () => (await count(SEL.exportReason)) > 0,
      "the export did not explain why it is disabled",
    );

    // Leave a source for the specs that follow.
    await showSources();
    await openFixture("sine440");
  });
});
