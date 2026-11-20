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
  openFixture,
  waitFor,
  waitForSourceLoaded,
  timelineReadoutText,
  count,
} from "../support/helpers.ts";

describe("H. Open an audio file from the OS as a new project", () => {
  before(async () => {
    await waitForApp();
    // The suite shares one app instance, so a source is often already loaded (and
    // `openFixture` skips reloading the same file). Start from a *different* fixture, so
    // the OS-open below is observable as a change instead of matching what was there.
    await openFixture("chirpNoise");
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:03.00"),
      "the starting fixture did not load",
    );
  });

  it("H0 an audio path opens as a fresh project with that source", async () => {
    await emitEvent("app:open-project", [FIXTURES.sine440]);
    await waitForSourceLoaded();
    // The 2 s sine is now the timeline's source (it replaced the 3 s chirp). A new project
    // clears the old source first, which unmounts the Timeline for a moment, so both
    // conditions are **waited for** rather than sampled once.
    await waitFor(
      async () => (await timelineReadoutText()).includes("0:02.00"),
      "the audio file never landed on the timeline as a source",
    );
    await waitFor(
      async () => (await count(SEL.timeline)) > 0,
      "the Timeline never came back after the OS-open",
    );

    // It is a new (untitled) project named after the file, not a loaded project path.
    const name = (await browser.execute(
      () =>
        document.querySelector('[data-testid="toolbar.project.name"]')?.textContent?.trim() ?? "",
    )) as string;
    expect(name).toContain("sine440");
  });
});
