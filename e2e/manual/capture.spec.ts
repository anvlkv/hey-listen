/**
 * Manual screenshots — **not** part of the E2E suite.
 *
 * Writes the element crops used by `docs/manual/`. Each shot is driven the same way a
 * user drives the app, so a chapter cannot describe a screen the app no longer shows.
 * It lives outside `e2e/specs/` for the same reason the marketing capture does: CI runs
 * only that directory's `*.spec.ts` files.
 *
 * Every chapter is illustrated with the same real recording — `video/story-assets/
 * analysis-example.heyl`, the Grieg *Holberg Suite* prelude the workbench is built
 * around — rather than synthetic fixtures, so the pictures show the numbers a user
 * would actually meet: 31.2 s of music framed on the loop, its annotations, and a
 * second project to compare against.
 *
 * Run with `npm run capture:manual` (needs the desktop app + WebDriver, like the suite).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureElement, captureRegion, hoverAt, trimUniform } from "../support/capture.ts";
import { compareToolFromMain, compareView, waitForCompareChart } from "../support/compare.ts";
import { FIXTURES, GRAPH_FIXTURES, SUBSYSTEM_FIXTURES } from "../support/fixtures.ts";
import { importGraph } from "../support/graph.ts";
import { expectLogErrors } from "../support/logs.ts";
import { analyzerAbout, analyzerPanel, SEL } from "../support/selectors.ts";
import {
  setInputValue,
  openTimelineMenu,
  closeTimelineMenu,
} from "../support/timelinePrecision.ts";
import {
  closeCurrentWindow,
  closeWindowsMatching,
  openProjectWindow,
  windowLabels,
} from "../support/windows.ts";
import {
  canvasHasInk,
  click,
  closeAllTabs,
  count,
  dismissPopovers,
  invokeCore,
  menuAction,
  mockReturn,
  openFileFixture,
  openSelect,
  openTool,
  pickOption,
  prepareFilePicker,
  prepareSynthSource,
  pressChord,
  textOf,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForShell,
  waitForSourceLoaded,
} from "../support/helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `docs/manual/assets/` — two levels up from this `e2e/manual/` directory. */
const ASSETS_DIR = path.resolve(HERE, "..", "..", "docs", "manual", "assets");

/** The story project every chapter is illustrated with (embedded audio + annotations). */
const EXAMPLE_PROJECT = path.resolve(
  HERE,
  "..",
  "..",
  "video",
  "story-assets",
  "analysis-example.heyl",
);

/** A second, shorter project (`testdrive-melody.heyl`) for the comparison chapter. */
const REFERENCE_PROJECT = path.resolve(
  HERE,
  "..",
  "..",
  "video",
  "story-assets",
  "testdrive-melody.heyl",
);

/** Cap each asset's width in device px; the manual shows them at the panel's size. */
const SHOT_WIDTH = 1600;

/** Force the shipped look, so every screenshot in one run shares it. */
async function forceDefaultTheme(): Promise<void> {
  await dismissPopovers();
  await click(SEL.toolbarView);
  await waitFor(async () => (await count(".pop-panel")) > 0, "the Appearance popover did not open");
  await click('.pop-panel [aria-label="Dark mode"]');
  await openSelect('.pop-panel [aria-label="Dark slot theme"]');
  await pickOption("Retrowave Neon");
  await dismissPopovers();
}

/** Open the Keyboard Shortcuts window, capture it, and return to `main`. */
async function captureShortcuts(): Promise<void> {
  await pressChord("?");
  await browser.waitUntil(async () => (await windowLabels()).includes("shortcuts"), {
    timeout: 15_000,
    timeoutMsg: "the shortcuts window never opened",
  });
  await browser.tauri.switchWindow("shortcuts");
  await waitFor(
    async () => (await count(SEL.shortcutsDialog)) === 1,
    "the shortcuts window never rendered",
  );
  await browser.pause(400);
  await capture(SEL.shortcutsDialog, "008-shortcuts");
  await closeCurrentWindow();
  await browser.tauri.switchWindow("main");
  await waitForShell();
}

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

/** Open a saved project through File → Open (the native picker mocked to `file`). */
async function openProjectAt(file: string, name: string): Promise<void> {
  await mockReturn("pick_project_open_path", file);
  await menuAction("open");
  await waitForSourceLoaded(120_000);
  await waitFor(
    async () => (await textOf(SEL.projectName)).includes(name),
    `the toolbar never showed the "${name}" project`,
    30_000,
  );
}

/**
 * Lay an imported graph out and fit the canvas to it.
 *
 * `autoLayout` fits on the next frame, before the fresh node cards have measured, so a
 * single fit can pick the wrong zoom: run it twice, once the graph has settled.
 */
async function settleGraphLayout(): Promise<void> {
  await click(SEL.graphLayout);
  await browser.pause(700);
  await click(SEL.graphLayout);
  await browser.pause(700);
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
    await forceDefaultTheme();
    await closeAllTabs();

    // The example project: 31.2 s of Grieg framed on the loop, with its annotations.
    await openProjectAt(EXAMPLE_PROJECT, "analysis-example");
    await closeAllTabs();

    // 001 — the shell, with the spectrogram of the framed window open.
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");
    const spectrogramCanvas = `${analyzerPanel("spectrogram")} canvas`;
    await browser.waitUntil(async () => canvasHasInk(spectrogramCanvas), {
      timeout: 30_000,
      timeoutMsg: "the spectrogram never drew anything",
    });
    await capture(SEL.app, "001-shell");

    // 002 — the Sources rail: one file source, embedded, with its storage choice.
    await click('[data-testid="activity.tab.sources"]');
    await waitFor(async () => (await count(SEL.source)) > 0, "the Sources rail did not open");
    await capture(SEL.source, "002-sources");

    // 002 (second shot) — the storage chooser every new file passes through.
    await prepareFilePicker();
    await mockReturn("pick_audio_file", "video/story-assets/Grieg_Holberg_Suite_1_Praeludium.wav");
    await click(SEL.sourceOpenFile);
    await waitFor(
      async () => (await count(SEL.storageDialog)) > 0,
      "the storage chooser did not open",
    );
    await capture(SEL.storageDialog, "002-storage");
    await click(SEL.storageDialogCancel);

    // 003 — the Timeline of the recording, with its analysis window and channel rail.
    await capture(SEL.timeline, "003-timeline");

    // 003 (second shot) — the numeric window fields; (third) the right-click menu.
    await click(SEL.timelineWindowEdit);
    await waitFor(
      async () => (await count(".pop-panel")) > 0,
      "the window-fields popover did not open",
    );
    await captureRegion([SEL.bottom, ".pop-panel"], shot("003-window"), SHOT_WIDTH);
    await dismissPopovers();

    await openTimelineMenu(0.55);
    await captureRegion([SEL.bottom, SEL.timelineMenu], shot("003-menu"), SHOT_WIDTH);
    await closeTimelineMenu();

    // 004 — a filter graph on the loaded music, then a nested subsystem.
    await closeAllTabs();
    await openTool("filter");
    await waitFor(
      async () => (await count(SEL.graphCanvas)) > 0,
      "the filter graph did not render",
    );
    await importGraph(GRAPH_FIXTURES.filter);
    await settleGraphLayout();

    // 004 (first shot) — the palette, before folding it away for the chain view.
    await capture(".graph-palette", "004-palette");

    await click("button.graph-palette-toggle");
    await browser.pause(300);
    await capture(SEL.workbench, "004-filter");
    await importGraph(SUBSYSTEM_FIXTURES.filter);
    await settleGraphLayout();
    await capture(SEL.workbench, "004-subsystem");

    // 005 — the spectrum of the same music, then its About popover.
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
    await capture(".pop-panel-about", "005-about");
    await dismissPopovers();

    // 005 (third shot) — the shared params every open tool reads.
    await click(SEL.toolbarParams);
    await waitFor(
      async () => (await count(".pop-panel")) > 0,
      "the shared-params popover did not open",
    );
    await capture(".pop-panel", "005-params");
    await dismissPopovers();

    // 006 — the annotations the project already carries, one selected so it is drawn on
    // the chart and the timeline as well as in the rail.
    await openAnnotationsRail();
    await click('[data-testid^="annotation.heading."]');
    await browser.pause(400);
    await capture(SEL.app, "006-annotations");

    // 006 (second shot) — editing one annotation in place.
    await click('[data-testid^="annotation.edit."]');
    await waitFor(
      async () => (await count('[data-testid^="annotation.bodyInput."]')) > 0,
      "the annotation editor did not open",
    );
    await capture(SEL.app, "006-editor");
    await click('[data-testid^="annotation.cancel."]');

    // 009 (second shot) — the per-tab analysis export menu.
    await click('[data-testid="analyzer.export.spectrum"]');
    await waitFor(
      async () => (await count(".pop-panel-export")) > 0,
      "the analysis export menu did not open",
    );
    await capture(".pop-panel-export", "009-export-menu");
    await dismissPopovers();

    // 009 (third shot) — the audio-export rail for the framed analysis window.
    await click('[data-testid="activity.tab.export"]');
    await waitFor(async () => (await count(SEL.exportRegion)) > 0, "the Export rail did not open");
    await capture(SEL.exportRegion, "009-export");

    // 007 — a comparison: the same spectrum on the melody project.
    const reference = await openProjectWindow();
    await browser.tauri.switchWindow(reference);
    await waitForShell();
    await openProjectAt(REFERENCE_PROJECT, "testdrive-melody");
    await closeAllTabs();
    await browser.tauri.switchWindow("main");
    await waitForShell();
    await compareToolFromMain("spectrum", reference);
    await waitForCompareChart("spectrum");
    await browser.pause(900);
    await capture(compareView("spectrum"), "007-compare");

    // 007 (second shot) — a matrix comparison switched to Δ.
    await closeAllTabs();
    await compareToolFromMain("melSpectrogram", reference);
    await waitForCompareChart("melSpectrogram");
    await click('[data-testid="compare.matrix.mode.delta"]');
    await waitFor(
      async () => (await count('[data-testid="compare.matrix.legend"]')) === 1,
      "the Δ legend never appeared",
    );
    await browser.pause(500);
    await capture(compareView("melSpectrogram"), "007-matrix");
    await closeAllTabs();

    // 008 — the transport, then the Keyboard Shortcuts window.
    await capture(SEL.timeline, "008-transport");
    await captureShortcuts();

    await capture(SEL.toolbar, "009-project");

    await dismissPopovers();
    await click(SEL.toolbarView);
    await waitFor(
      async () => (await count(".pop-panel")) > 0,
      "the appearance popover did not open",
    );
    await capture(".pop-panel", "010-appearance");
    await dismissPopovers();

    // 010 (second shot) — the app log, opened the way Help does.
    const logWindow = await invokeCore<string>("open_log_window");
    await browser.tauri.switchWindow(logWindow);
    await waitFor(async () => (await count(SEL.logWindow)) > 0, "the log window never rendered");
    await browser.pause(500);
    await setInputValue(SEL.logFilter, "analysis");
    await browser.pause(600);
    await capture(SEL.logWindow, "010-log");
    trimUniform(shot("010-log"));
    await closeCurrentWindow();
    await browser.tauri.switchWindow("main");
    await waitForShell();

    // 011 — a Toolbar error from a file the app cannot decode. Close the compare tab and
    // its reference first: replacing main's source would otherwise make an open
    // comparison re-run with no audio and log an error that is not the shot's subject.
    await closeAllTabs();
    await closeWindowsMatching(/^project-\d+$/);
    await browser.tauri.switchWindow("main");
    await openFileFixture(FIXTURES.corrupt);
    await capture(SEL.app, "011-error");

    // 002 (second shot) — a rendered synth source, captured last because a render
    // replaces the project's source.
    await openTool("synth");
    await importGraph(SUBSYSTEM_FIXTURES.synth);
    await settleGraphLayout();
    await prepareSynthSource();
    await setInputValue(SEL.synthLength, "8");
    await click(SEL.graphRender);
    await waitForSourceLoaded();
    await capture(SEL.timeline, "002-synth");
  });
});
