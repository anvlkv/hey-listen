/**
 * H. Opening a file from the OS (audio formats).
 *
 * A supported audio path delivered through the file-association channel
 * (`app:open-project`, the same event Rust emits for a macOS `open` / command-line
 * path) must open as a **fresh project** with that file as the source — so a
 * double-clicked `.mp3`/`.wav` is analysed without going through the picker. A
 * `.heyl` path keeps loading as a project (covered by `j-project.spec.ts`).
 *
 * A new app session starts with no source.
 */

import { SEL } from "../support/selectors.ts";
import { FIXTURES } from "../support/fixtures.ts";
import {
  waitForApp,
  emitEvent,
  waitForSourceLoaded,
  timelineReadoutText,
  count,
} from "../support/helpers.ts";

describe("H. Open an audio file from the OS as a new project", () => {
  before(async () => {
    await waitForApp();
  });

  it("H0 an audio path opens as a fresh project with that source", async () => {
    await emitEvent("app:open-project", [FIXTURES.sine440]);
    await waitForSourceLoaded();
    // The 2 s sine is now the timeline's source.
    await browser.waitUntil(async () => (await timelineReadoutText()).includes("0:02.00"), {
      timeoutMsg: "the audio file never landed on the timeline as a source",
    });
    expect(await count(SEL.timeline)).toBeGreaterThan(0);

    // It is a new (untitled) project named after the file, not a loaded project path.
    const name = (await browser.execute(
      () =>
        document.querySelector('[data-testid="toolbar.project.name"]')?.textContent?.trim() ?? "",
    )) as string;
    expect(name).toContain("sine440");
  });
});
