/**
 * Landing screenshots — **not** part of the E2E suite.
 *
 * Runs only through `screenshots.wdio.conf.ts` (`npm run landing:shots`). It lives
 * outside `e2e/specs/` on purpose: CI only runs the `*.spec.ts` files in that
 * directory, so a normal run never captures landing PNGs.
 *
 * Every image is an **element crop** of the running app, like the manual's capture:
 *   - the analyzer panel for each Sidebar section (never an exported chart);
 *   - the whole workbench, as the analysis section's main screenshot;
 *   - the analysis-result Export popover and the audio-export rail;
 *   - the empty project's Sources rail in its linked-file, application and synth
 *     states, plus the open source-kind list.
 *
 * The recording is `video/story-assets/analysis-example.heyl`, the same project the
 * manual illustrates, so the landing cannot drift from a real app state.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { newEmptyProject } from "../support/app.ts";
import { captureElement, captureRegion, hoverAt, trimUniform } from "../support/capture.ts";
import { FIXTURES } from "../support/fixtures.ts";
import { dismissPopovers, openSelect, pickOption } from "../support/popups.ts";
import { analyzerPanel, SEL } from "../support/selectors.ts";
import { prepareFilePicker, showSources } from "../support/source.ts";
import { closeWindowsMatching } from "../support/windows.ts";
import {
  canvasHasInk,
  click,
  closeAllTabs,
  count,
  emitEvent,
  mockReturn,
  openTool,
  textOf,
  waitFor,
  waitForAnalyzer,
  waitForApp,
  waitForSourceLoaded,
} from "../support/helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `landing/public/images/` — two levels up from this `e2e/screenshots/` directory. */
const IMAGES_DIR = path.resolve(HERE, "..", "..", "landing", "public", "images");
const ANALYZER_DIR = path.join(IMAGES_DIR, "analyzers");
const SOURCE_DIR = path.join(IMAGES_DIR, "sources");

/** The shared story project: 31.2 s of Grieg with its annotations. */
const PROJECT = path.resolve(HERE, "..", "..", "video", "story-assets", "analysis-example.heyl");

/** Cap each crop in device px; the page shows them at panel width. */
const SHOT_WIDTH = 1600;

const ANALYZERS = [
  { id: "waveform", name: "time" },
  { id: "spectrum", name: "spectral" },
  { id: "pitchYin", name: "pitch" },
  { id: "tempo", name: "rhythm" },
  { id: "loudnessMomentary", name: "loudness" },
  { id: "sharpness", name: "perception" },
] as const;

const image = (dir: string, name: string) => path.join(dir, `${name}.png`);

/** Open a source-kind option in the Sources rail. */
async function chooseSourceKind(label: string): Promise<void> {
  await openSelect('[data-testid="source.kind"]');
  await pickOption(label);
}

/** Clear a synthetic click's focus ring so it does not frame the screenshot. */
async function blurActive(): Promise<void> {
  await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Close the Kobalte select's portaled listbox. */
async function closeSelect(): Promise<void> {
  await browser.execute(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await browser.waitUntil(async () => (await count(".pop-item")) === 0, {
    timeoutMsg: "the source-kind list did not close",
  });
}

/** Capture one analyzer panel with ink and a crosshair, never the exported chart. */
async function captureAnalyzer(id: string, name: string): Promise<void> {
  await closeAllTabs();
  await openTool(id);
  await waitForAnalyzer(id);
  const canvas = `${analyzerPanel(id)} canvas`;
  await browser.waitUntil(async () => canvasHasInk(canvas), {
    timeout: 30_000,
    timeoutMsg: `the "${id}" chart never drew anything`,
  });
  await hoverAt(canvas);
  await captureElement(analyzerPanel(id), image(ANALYZER_DIR, name), SHOT_WIDTH);
}

describe("Landing screenshots", () => {
  after(async () => {
    await closeWindowsMatching(/^(popout|compare|project)-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});
  });

  it("captures the analyzers, the export surfaces, and the source deck", async () => {
    await mkdir(ANALYZER_DIR, { recursive: true });
    await mkdir(SOURCE_DIR, { recursive: true });

    await waitForApp();
    await browser.tauri.switchWindow("main");
    await mockReturn("confirm", true);
    // A persisted UI scale (a developer's session) would make the element box and the
    // screenshot disagree by a few pixels, pulling a sliver of the annotations rail into
    // every analyzer crop. Capture at 100% so the crops are exactly the panel.
    await browser.execute(() => {
      try {
        localStorage.setItem("hey-listen:font-scale", "1");
      } catch {
        // A read-only storage is fine; the CSS variable below still applies.
      }
      document.documentElement.style.setProperty("--ui-scale", "1");
    });
    // Give the Workbench enough height for the analyzer panel and its legend; the
    // default window leaves the panel a few pixels under the timeline.
    await browser.setWindowSize(1280, 860).catch(() => {});
    await browser.pause(300);
    await closeAllTabs();

    // The story project: source, window, annotations and tabs all come from the file.
    await emitEvent("app:open-project", [PROJECT]);
    await waitForSourceLoaded(120_000);
    await waitFor(
      async () => (await textOf(SEL.projectName)).includes("analysis-example"),
      "the story project never became the current one",
    );
    // The open annotations rail overlays the analyzer panel's right edge when the
    // window is narrow; the landing images should be the panel alone.
    if ((await count(SEL.annotationsRegion)) > 0) {
      await click(SEL.toolbarAnnotations);
      await waitFor(
        async () => (await count(SEL.annotationsRegion)) === 0,
        "the annotations rail did not close",
      );
    }
    await closeAllTabs();

    for (const analyzer of ANALYZERS) {
      await captureAnalyzer(analyzer.id, analyzer.name);
    }

    // The whole workbench, for the analysis section's main screenshot.
    await closeAllTabs();
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");
    const spectrogramCanvas = `${analyzerPanel("spectrogram")} canvas`;
    await browser.waitUntil(async () => canvasHasInk(spectrogramCanvas), {
      timeout: 30_000,
      timeoutMsg: "the spectrogram never drew anything",
    });
    await hoverAt(spectrogramCanvas);
    await blurActive();
    await captureElement(SEL.app, image(IMAGES_DIR, "analysis-workbench"), SHOT_WIDTH);

    // The analysis-result Export popover, on a live analysis.
    await closeAllTabs();
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    await click('[data-testid="analyzer.export.spectrum"]');
    await waitFor(
      async () => (await count(".pop-panel-export")) > 0,
      "the analysis export popover did not open",
    );
    await blurActive();
    await captureElement(".pop-panel-export", image(IMAGES_DIR, "export-popover"), 1200);
    await dismissPopovers();

    // The Export rail: the analysis window as an audio file.
    await click('[data-testid="activity.tab.export"]');
    await waitFor(async () => (await count(SEL.exportRegion)) > 0, "the Export rail did not open");
    await captureElement(SEL.exportRegion, image(IMAGES_DIR, "export-rail"), 1200);
    trimUniform(image(IMAGES_DIR, "export-rail"));

    // The Sources deck: an **empty** project, so the rail shows the choices rather than
    // the story project's already-loaded file.
    await newEmptyProject();
    await showSources();

    await chooseSourceKind("Audio file");
    await waitFor(
      async () => (await count(SEL.sourceOpenFile)) > 0,
      "the empty file source did not render",
    );

    await openSelect('[data-testid="source.kind"]');
    await waitFor(async () => (await count(".pop-content")) > 0, "the source list did not open");
    await captureRegion([SEL.source, ".pop-content"], image(SOURCE_DIR, "kinds"), SHOT_WIDTH);
    await closeSelect();

    // Add audio: a file loaded as **linked**, so the panel offers all three storage
    // cards (embedded is always available, and both link modes are unlocked).
    await prepareFilePicker();
    await mockReturn("pick_audio_file", FIXTURES.sine440);
    await click(SEL.sourceOpenFile);
    await waitFor(
      async () => (await count(SEL.storageDialog)) > 0,
      "the storage chooser did not open",
    );
    await click(SEL.storageDialogLinked);
    await browser.pause(250);
    await click(SEL.storageDialogOpen);
    await waitForSourceLoaded();
    await waitFor(
      async () => (await textOf(SEL.sourceStorageBadge)).includes("Linked"),
      "the source badge never settled on Linked",
    );
    await blurActive();
    await captureElement(SEL.source, image(SOURCE_DIR, "add-audio"), SHOT_WIDTH);

    // The live-input state. **Application** opens no capture session until an app is
    // chosen, so the shot is the controls rather than a permission error.
    await newEmptyProject();
    await showSources();
    await chooseSourceKind("Application");
    await waitFor(
      async () => (await count(SEL.sourceRecord)) > 0,
      "the application source did not render",
    );
    await blurActive();
    await captureElement(SEL.source, image(SOURCE_DIR, "application"), SHOT_WIDTH);

    await chooseSourceKind("Synth (graph)");
    await waitFor(
      async () => (await count(SEL.graphRender)) > 0,
      "the synth source did not render",
    );
    await blurActive();
    await captureElement(SEL.source, image(SOURCE_DIR, "synth"), SHOT_WIDTH);
  });
});
