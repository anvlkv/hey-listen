/**
 * Marketing screenshot capture — **not** part of the E2E suite.
 *
 * Runs only through `screenshots.wdio.conf.ts` (`npm run screenshots`), which points
 * `specs` at this one file. It lives outside `e2e/specs/` on purpose: CI only runs the
 * `*.spec.ts` files in that directory, so a normal run never captures marketing PNGs.
 *
 * The shots come from a **project file** rather than a hand-built sequence of MCP
 * calls: the file carries the source (embedded PCM), the Workbench grid, the filter,
 * the analysis window and the notes, so the page cannot drift from the app's real
 * state — and the analyzer *grid* is only reachable by restoring a saved layout (the
 * app opens every new tab into the focused group, so a split cannot be scripted).
 *
 * It writes five PNGs into `site/assets/`:
 *   - `hero.png`      — the whole window: Spectrogram + Tempo over Level meters, with
 *                       the notes rail open and the phrase note's span drawn.
 *   - `pitch.png`     — the Pitch (autocorrelation) popout window, on its own.
 *   - `spectrum.png`  — clipped to the spectrum panel.
 *   - `tempo.png`     — clipped to the tempo (rhythm) panel.
 *   - `filter.png`    — the filter graph editor, showing the band-pass the project
 *                       carries (it is what makes the analyzers read a clean signal).
 *
 * Capture-specific details:
 *   - The core's replace-source / discard-changes `confirm` is mocked to `true` so no
 *     native dialog can appear and block a capture.
 *   - A synthetic pointer position is emulated over a chart so its crosshair (and
 *     hover tooltip / readouts) render in the shot.
 *   - The embedded driver's "take element screenshot" returns the full viewport, so
 *     the detail shots are captured full-viewport and cropped with ImageMagick; every
 *     asset is then capped to a sensible width (the app may well be running
 *     maximized, and a page never wants a 3k-wide PNG).
 */

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzerPanel, SEL } from "../support/selectors.ts";
import { closeWindowsMatching, windowLabels } from "../support/windows.ts";
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
  waitForReadouts,
  waitForSourceLoaded,
} from "../support/helpers.ts";

/** `site/assets/` — two levels up from this `e2e/screenshots/` directory. */
const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "site",
  "assets",
);

/** The project the shots are taken from (see `docs/testing.md` → Marketing screenshots). */
const PROJECT = "/Users/anvlkv/Downloads/blue capped ifrit.heyl";

/** The heading of the note focused for the shots — the call-phrase **range** note. */
const FOCUS_NOTE_HEADING = "Call phrase";

/** Cap each asset's width, in device px (the page shows them at 960 CSS px, so 2x). */
const ASSET_WIDTH = 1954;

/** The canvas element(s) inside each analyzer panel that render a crosshair on hover. */
const CHART_TARGETS = {
  spectrum: '[data-testid="analyzer.spectrum"] canvas',
  spectrogram: '[data-testid="analyzer.spectrogram"] canvas',
  tempo: '[data-testid="analyzer.tempo"] canvas',
} as const;

/** The first note row's heading (`ids are uuid-based, so match the prefix`). */
const FIRST_NOTE_HEADING = '[data-testid^="note.row."] [data-testid^="note.heading."]';

/** Drive the app's own MCP surface (the same path an agent uses). */
let mcpId = 1;
async function mcp(tool: string, args: Record<string, unknown>): Promise<void> {
  await emitEvent("mcp:request", { id: mcpId++, tool, arguments: args });
}

/**
 * Emulate a mouse position over a chart so its crosshair (and hover tooltip /
 * readouts) render in the screenshot.
 *
 * uPlot's cursor and the spectrogram's `onPointerMove` both read `clientX` /
 * `clientY`, so a synthetic `pointermove` + `mousemove` at the element's own rect is
 * enough to place the crosshair — no trusted pointer required (the same technique the
 * suite's `pointerDrag` helper already relies on). `fx`/`fy` are fractional offsets
 * into the element's box (default centre).
 */
async function hoverAt(selector: string, fx = 0.5, fy = 0.5): Promise<void> {
  await browser.execute(
    (sel: string, fx: number, fy: number) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      if (els.length === 0) throw new Error(`hoverAt: no element for ${sel}`);
      // Position from the first match; uPlot's over canvas shares the plot box.
      const rect = els[0].getBoundingClientRect();
      const clientX = rect.left + rect.width * fx;
      const clientY = rect.top + rect.height * fy;
      const init = { bubbles: true, cancelable: true, clientX, clientY, view: window };
      for (const el of els) {
        el.dispatchEvent(
          new PointerEvent("pointermove", {
            ...init,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          }),
        );
        el.dispatchEvent(new MouseEvent("mousemove", init));
      }
    },
    selector,
    fx,
    fy,
  );
  // Let the reactive redraw paint the crosshair before the next capture.
  await browser.pause(200);
}

/** Cap an asset's width (no upscaling) so a maximized window cannot bloat the page. */
function capWidth(label: string, maxWidth: number): void {
  const file = path.join(ASSETS_DIR, `${label}.png`);
  try {
    execFileSync("magick", [file, "-resize", `${maxWidth}x>`, file]);
  } catch (err) {
    console.warn(`magick resize for "${label}" failed; keeping the full-size PNG:`, err);
  }
}

/**
 * Capture the viewport and crop it to `selector`'s bounding box (CSS px ×
 * `devicePixelRatio`) with ImageMagick. The embedded driver's element screenshot
 * returns the whole viewport, so this is how "clipped to element" is done.
 */
async function cropElement(label: string, selector: string): Promise<void> {
  const box = (await browser.execute((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`cropElement: no element for ${sel}`);
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      dpr: window.devicePixelRatio || 1,
    };
  }, selector)) as { left: number; top: number; width: number; height: number; dpr: number };

  const file = path.join(ASSETS_DIR, `${label}.png`);
  const full = path.join(ASSETS_DIR, `.${label}.full.png`);
  await browser.saveScreenshot(full);

  const w = Math.round(box.width * box.dpr);
  const h = Math.round(box.height * box.dpr);
  const x = Math.round(box.left * box.dpr);
  const y = Math.round(box.top * box.dpr);
  try {
    execFileSync("magick", [full, "-crop", `${w}x${h}+${x}+${y}`, "+repage", file]);
    capWidth(label, ASSET_WIDTH);
  } catch (err) {
    console.warn(`magick crop for "${label}" failed; keeping the full viewport shot:`, err);
    await browser.saveScreenshot(file);
  } finally {
    rmSync(full, { force: true });
  }
}

/** Save an analyzer panel, cropped, once its chart has ink and a crosshair placed. */
async function captureAnalyzer(id: keyof typeof CHART_TARGETS): Promise<void> {
  await browser.waitUntil(async () => canvasHasInk(`${analyzerPanel(id)} canvas`), {
    timeout: 30_000,
    timeoutMsg: `the "${id}" canvas never drew anything to capture`,
  });
  await hoverAt(CHART_TARGETS[id]);
  await cropElement(id, analyzerPanel(id));
}

/** Capture the app's one analyzer popout window (the project restores it on load). */
async function capturePopout(label: string, tool: string, popout: string): Promise<void> {
  await browser.tauri.switchWindow(popout);
  await hoverAt(`[data-testid="analyzer.${tool}"] canvas`);
  await browser.saveScreenshot(path.join(ASSETS_DIR, `${label}.png`));
  capWidth(label, ASSET_WIDTH);
  await browser.tauri.switchWindow("main");
}

/**
 * Wait for the popout window the project restores, and for its chart to draw — then
 * come back to `main`. Returns the popout's window label.
 *
 * Waiting is also what makes the filter correct: opening a project restores the graph
 * into the editor, but the **analysis** only picks it up once the graph is pushed to the
 * core again (the popout window boots its own seeded copy and lands it in the *shared*
 * core after the project's own). So the caller re-applies the filter once this returns.
 */
async function waitForPopout(tool: string): Promise<string> {
  let popout = "";
  await waitFor(async () => {
    popout = (await windowLabels()).find((name) => /^popout-\d+$/.test(name)) ?? "";
    return popout !== "";
  }, "the project's popout window never appeared");

  await browser.tauri.switchWindow(popout);
  await browser.waitUntil(async () => (await count(analyzerPanel(tool))) > 0, {
    timeout: 60_000,
    timeoutMsg: `the popout never rendered the "${tool}" panel`,
  });
  await browser.waitUntil(async () => canvasHasInk(`[data-testid="analyzer.${tool}"] canvas`), {
    timeout: 30_000,
    timeoutMsg: `the popout's "${tool}" chart never drew anything`,
  });
  await browser.tauri.switchWindow("main");
  return popout;
}

/** Make sure the notes rail is open, and that it has the project's rows. */
async function openNotesRail(): Promise<void> {
  if ((await count(SEL.notesRegion)) === 0) {
    await click(SEL.toolbarNotes);
    await waitFor(async () => (await count(SEL.notesRegion)) > 0, "the notes rail did not open");
  }
  await waitFor(
    async () => (await count(FIRST_NOTE_HEADING)) > 0,
    "the notes rail showed no note rows",
  );
}

/**
 * Select the note headed `heading` (its markdown's first line) by clicking the row.
 * Selecting is what focuses a note — and a focused note only draws its full-height
 * span while the rail is open, which is exactly what the hero shows.
 */
async function focusNote(heading: string): Promise<void> {
  const clicked = (await browser.execute((wanted: string) => {
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="note.heading."]'),
    );
    const match = headings.find((el) => (el.textContent ?? "").trim() === wanted);
    if (!match) return false;
    match.click();
    return true;
  }, heading)) as boolean;
  if (!clicked) throw new Error(`no note row is headed "${heading}"`);
}

describe("Marketing screenshots", () => {
  // The popout is this spec's to close: the next session must start on a single window.
  after(async () => {
    await closeWindowsMatching(/^(popout|note)-\d+$/);
    await browser.tauri.switchWindow("main").catch(() => {});
  });

  it("captures the workbench, the pitch popout, and the analyzer details", async () => {
    await waitForApp();
    // Auto-answer the core's replace-source / discard-changes confirm so no native
    // dialog can appear or block a capture.
    await mockReturn("confirm", true);
    await closeAllTabs();

    // Open the project the shots describe: source, Workbench grid, filter, analysis
    // window and notes all travel with the file.
    await emitEvent("app:open-project", [PROJECT]);
    await waitForSourceLoaded();
    await waitFor(
      async () => (await textOf(SEL.projectName)).includes("blue capped"),
      "the project never became the current one",
    );

    // Its Workbench: a left column of Spectrogram over Tempo, and Level meters beside.
    // Every panel is its own group, so all three mount (and compute) at once.
    for (const id of ["spectrogram", "tempo", "levels"]) {
      await waitFor(async () => (await count(`[data-testid="tab.${id}"]`)) > 0, `no "${id}" tab`);
    }
    await waitForAnalyzer("spectrogram");
    await waitForAnalyzer("tempo");
    // Level meters is a readout-card analyzer, so it has no chart to wait on.
    await waitForReadouts("levels");

    // The popout window boots a copy of the app; once it (and its chart) is up, re-apply
    // the project's filter so every *analysis* below runs against the filtered audio.
    const popout = await waitForPopout("pitchAutocorr");
    await mcp("set_filter_graph", { enabled: true });
    await browser.pause(1200); // let every open chart re-run against the filtered audio

    // The rail carries the annotations, and the focused note draws across every
    // time-based chart — so focus the phrase note before the shot.
    await openNotesRail();
    await focusNote(FOCUS_NOTE_HEADING);

    // Hero: a crosshair on the spectrogram, and preview running so the toolbar's
    // output meter reads live levels.
    await hoverAt(CHART_TARGETS.spectrogram);
    await mcp("preview", {});
    await browser.pause(800); // let the output meter fill
    await browser.saveScreenshot(path.join(ASSETS_DIR, "hero.png"));
    capWidth("hero", ASSET_WIDTH);
    await mcp("stop_preview", {});

    // The Pitch (autocorrelation) popout the project restores, captured on its own.
    await capturePopout("pitch", "pitchAutocorr", popout);

    // Detail shots: one analyzer alone in the Workbench (the crop excludes the rail).
    await closeAllTabs();
    await openTool("spectrum");
    await captureAnalyzer("spectrum");

    await closeAllTabs();
    await openTool("tempo");
    await captureAnalyzer("tempo");

    // The filter graph last: the project's band-pass is applied to every analysis
    // above, so this shot needs no setup beyond opening the tab.
    await closeAllTabs();
    await openTool("filter");
    await waitFor(
      async () => (await textOf(SEL.graphHint)).includes("applied"),
      "the filter graph did not report as applied",
    );
    await cropElement("filter", ".graph-editor");
  });
});
