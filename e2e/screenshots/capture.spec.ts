/**
 * Marketing screenshot capture — **not** part of the E2E suite.
 *
 * Runs only through `screenshots.wdio.conf.ts` (`npm run screenshots`), which points
 * `specs` at this one file. It lives outside `e2e/specs/` on purpose: CI only runs the
 * `*.spec.ts` files in that directory, so a normal run never captures marketing PNGs.
 *
 * It binds the release app to a real audio file, installs a filter graph + a focused
 * analysis window, and writes four PNGs into `site/assets/` — one distinct view each:
 *   - `filter.png`       — the filter graph editor.
 *   - `spectrogram.png`  — clipped to the spectrogram panel (filter applied).
 *   - `tempo.png`        — clipped to the tempo (rhythm) panel (filter applied).
 *   - `hero.png`         — the full viewport, spectrum active (filter applied).
 *
 * Capture-specific details:
 *   - The core's replace-source / discard-changes `confirm` is mocked to `true` so no
 *     native dialog can appear and block a capture.
 *   - The filter graph + analysis window are installed through the app's own MCP
 *     surface (an `mcp:request` event), the same path an agent uses — so the editor
 *     shows the graph and the analyzers are conditioned by it.
 *   - A synthetic pointer position is emulated over each chart so its crosshair (and
 *     hover tooltip / readouts) render in the shot.
 *   - The embedded driver's "take element screenshot" returns the full viewport, so
 *     the detail shots are captured full-viewport and cropped with ImageMagick.
 */

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzerPanel, SEL } from "../support/selectors.ts";
import {
  waitForApp,
  closeAllTabs,
  emitEvent,
  waitForSourceLoaded,
  openTool,
  waitForAnalyzer,
  canvasHasInk,
  mockReturn,
  count,
  textOf,
} from "../support/helpers.ts";

/** `site/assets/` — two levels up from this `e2e/screenshots/` directory. */
const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "site",
  "assets",
);

/** The audio file the marketing screenshots analyse (a short bird-call recording). */
const SOURCE = "/Users/anvlkv/Downloads/XC673283 - Blue-capped Ifrit - Ifrita kowaldi.mp3";

/** The analysis window (source seconds): a representative slice, not the whole file. */
const WINDOW = { start: 10, end: 16 };

/**
 * A tasteful filter graph: `Input → High-pass(300 Hz) → Low-pass(7 kHz) → Gain → Output`
 * — a band-pass that trims rumble and hiss so the bird's voice comes forward.
 */
const FILTER_GRAPH = {
  nodes: [
    {
      id: "input",
      type: "graph",
      position: { x: 40, y: 150 },
      data: { kind: "input", params: {}, graph: "filter" },
    },
    {
      id: "highpass",
      type: "graph",
      position: { x: 220, y: 150 },
      data: { kind: "highpass", params: { freq: 300, q: 1 }, graph: "filter" },
    },
    {
      id: "lowpass",
      type: "graph",
      position: { x: 400, y: 150 },
      data: { kind: "lowpass", params: { freq: 7000, q: 1 }, graph: "filter" },
    },
    {
      id: "gain",
      type: "graph",
      position: { x: 580, y: 150 },
      data: { kind: "gain", params: { gain: 1 }, graph: "filter" },
    },
    {
      id: "output",
      type: "graph",
      position: { x: 760, y: 150 },
      data: { kind: "output", params: {}, graph: "filter" },
    },
  ],
  edges: [
    { id: "e1", source: "input", target: "highpass", sourceHandle: "0", targetHandle: "0" },
    { id: "e2", source: "highpass", target: "lowpass", sourceHandle: "0", targetHandle: "0" },
    { id: "e3", source: "lowpass", target: "gain", sourceHandle: "0", targetHandle: "0" },
    { id: "e4", source: "gain", target: "output", sourceHandle: "0", targetHandle: "0" },
  ],
};

/** The canvas element(s) inside each analyzer panel that render a crosshair on hover. */
const CHART_TARGETS = {
  spectrum: '[data-testid="analyzer.spectrum"] canvas',
  spectrogram: '[data-testid="analyzer.spectrogram"] canvas',
  tempo: '[data-testid="analyzer.tempo"] canvas',
} as const;

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

/** Save the filter graph editor once its nodes are rendered and the filter is applied. */
async function captureFilterGraph(): Promise<void> {
  await browser.waitUntil(
    async () => (await count('[data-testid="graph.node"]')) >= FILTER_GRAPH.nodes.length,
    { timeout: 15_000, timeoutMsg: "the filter graph nodes never rendered" },
  );
  await browser.waitUntil(async () => (await textOf(SEL.graphHint)).includes("applied"), {
    timeout: 10_000,
    timeoutMsg: "the filter graph did not report as applied",
  });
  await cropElement("filter", ".graph-editor");
}

describe("Marketing screenshots", () => {
  it("captures the filter graph, analyzer details, and hero", async () => {
    await waitForApp();
    // Auto-answer the core's replace-source / discard-changes confirm so no native
    // dialog can appear or block a capture.
    await mockReturn("confirm", true);
    await closeAllTabs();

    // Open the audio file as a fresh project (the same channel macOS `open` uses).
    await emitEvent("app:open-project", [SOURCE]);
    await waitForSourceLoaded();

    // Focus the analyzers on a representative slice, then shape it with a filter.
    await mcp("set_analysis_window", { start: WINDOW.start, end: WINDOW.end });
    await mcp("set_filter_graph", { graph: FILTER_GRAPH, enabled: true });
    await browser.pause(1000); // let the filter net compile + install in the core

    // Filter graph editor first (the graph survives its tab being closed).
    await openTool("filter");
    await captureFilterGraph();

    // Analyzer details — each rendered with the filter applied.
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");
    await captureAnalyzer("spectrogram");

    await openTool("tempo");
    await waitForAnalyzer("tempo");
    await captureAnalyzer("tempo");

    // Hero: start preview so the toolbar output meter reads live levels, re-focus the
    // spectrum tab, then capture the whole window.
    await mcp("preview", {});
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
    await hoverAt(CHART_TARGETS.spectrum);
    await browser.pause(600); // let the output meter fill
    await browser.saveScreenshot(path.join(ASSETS_DIR, "hero.png"));
    await mcp("stop_preview", {});
  });
});
