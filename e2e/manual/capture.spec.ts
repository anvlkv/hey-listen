/**
 * Manual screenshots — **not** part of the E2E suite.
 *
 * Writes the element crops used by `docs/manual/`. Each shot is driven the same way a
 * user drives the app, so a chapter cannot describe a screen the app no longer shows.
 * It lives outside `e2e/specs/` for the same reason the marketing capture does: CI runs
 * only that directory's `*.spec.ts` files.
 *
 * Run with `npm run manual:shots` (needs the desktop app + WebDriver, like the suite).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureElement, hoverAt } from "../support/capture.ts";
import {
  compareToolFromMain,
  compareView,
  openProjectWithFixture,
  waitForCompareChart,
} from "../support/compare.ts";
import { FIXTURES, SUBSYSTEM_FIXTURES } from "../support/fixtures.ts";
import { importGraph } from "../support/graph.ts";
import { expectLogErrors } from "../support/logs.ts";
import { analyzerAbout, analyzerPanel, firstAnnotationRow, SEL } from "../support/selectors.ts";
import { closeWindowsMatching } from "../support/windows.ts";
import {
  canvasHasInk,
  click,
  closeAllTabs,
  count,
  dismissPopovers,
  ensureSourcePanel,
  mockReturn,
  openFileFixture,
  openFixture,
  openTool,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForSourceLoaded,
} from "../support/helpers.ts";

/** `docs/manual/assets/` — two levels up from this `e2e/manual/` directory. */
const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "manual",
  "assets",
);

/** Cap each asset's width in device px; the manual shows them at the panel's size. */
const SHOT_WIDTH = 1600;

const shot = (name: string) => path.join(ASSETS_DIR, `${name}.png`);

// 011 deliberately opens a file the app cannot decode; the probe error it logs is the
// point of the shot.
expectLogErrors(/probe_file failed: unsupported or unrecognized audio format/);

/** Wait for a selector, then crop the viewport to it into `name`.png. */
async function capture(selector: string, name: string): Promise<void> {
  await browser.waitUntil(async () => (await count(selector)) > 0, {
    timeout: 30_000,
    timeoutMsg: `nothing to capture for "${name}" (${selector})`,
  });
  await captureElement(selector, shot(name), SHOT_WIDTH);
}

/** Open the Annotations rail when it is collapsed. */
async function openAnnotationsRail(): Promise<void> {
  if ((await count(SEL.annotationsRegion)) > 0) return;
  await click(SEL.toolbarAnnotations);
  await waitFor(
    async () => (await count(SEL.annotationsRegion)) > 0,
    "the annotations rail did not open",
  );
}

describe("Manual screenshots", () => {
  // The compare reference window is this spec's to close.
  after(async () => {
    await closeWindowsMatching(/^(popout|compare|project)-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});
  });

  it("captures every manual chapter", async () => {
    await waitForApp();
    await browser.tauri.switchWindow("main");
    await mockReturn("confirm", true);
    await closeAllTabs();

    // 001 — the shell, with one analyzer open.
    await openFixture("chirpNoise");
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");
    await capture(SEL.app, "001-shell");

    // 002 — the source panel, then a rendered synth source. Once a source exists the
    // panel hides behind the Timeline's *Replace…* button, so open it first.
    await ensureSourcePanel();
    await capture(SEL.source, "002-source-panel");
    await openTool("synth");
    await click(SEL.graphRender);
    await waitForSourceLoaded();
    await capture(SEL.timeline, "002-synth-source");

    // 003 — the timeline of a real recording.
    await openFixture("chirpNoise");
    await capture(SEL.timeline, "003-timeline");

    // 004 — a filter graph, then a nested subsystem.
    await closeAllTabs();
    await openTool("filter");
    await waitFor(
      async () => (await count(SEL.graphCanvas)) > 0,
      "the filter graph did not render",
    );
    await browser.pause(600);
    await capture(SEL.workbench, "004-filter-graph");
    await importGraph(SUBSYSTEM_FIXTURES.filter);
    await browser.pause(1200);
    await capture(SEL.workbench, "004-subsystem");

    // 005 — a spectrum chart, then its About popover.
    await closeAllTabs();
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    const spectrumCanvas = `${analyzerPanel("spectrum")} canvas`;
    await browser.waitUntil(async () => canvasHasInk(spectrumCanvas), {
      timeout: 30_000,
      timeoutMsg: "the spectrum chart never drew anything",
    });
    await hoverAt(spectrumCanvas);
    await capture(analyzerPanel("spectrum"), "005-spectrum");

    await click(analyzerAbout("spectrum"));
    await capture(".pop-panel-about", "005-analyzer-about");
    await dismissPopovers();

    // 006 — an annotation in the rail.
    await openAnnotationsRail();
    if ((await count(firstAnnotationRow)) === 0) {
      await click(SEL.annotationsAdd);
      await waitFor(
        async () => (await count(firstAnnotationRow)) > 0,
        "the annotation row never appeared",
      );
    }
    await capture(SEL.annotationsRegion, "006-annotations");

    // 007 — a comparison against a second project.
    const reference = await openProjectWithFixture("sine440");
    await compareToolFromMain("spectrum", reference);
    await waitForCompareChart("spectrum");
    await capture(compareView("spectrum"), "007-compare");

    // 008 — the transport, 009 — the project chrome, 010 — the appearance popover.
    await capture(SEL.timeline, "008-transport");
    await capture(SEL.toolbar, "009-project");

    await dismissPopovers();
    await click(SEL.toolbarView);
    await waitFor(
      async () => (await count(".pop-panel")) > 0,
      "the appearance popover did not open",
    );
    await capture(".pop-panel", "010-themes");
    await dismissPopovers();

    // 011 — a toolbar error from a file the app cannot decode. Close the compare tab and
    // its reference first: replacing main's source would otherwise make an open
    // comparison re-run with no audio and log an error that is not the shot's subject.
    await closeAllTabs();
    await closeWindowsMatching(/^project-\d+$/);
    await browser.tauri.switchWindow("main");
    await openFileFixture(FIXTURES.corrupt);
    await capture(SEL.toolbarError, "011-errors");
  });
});
