/**
 * N. Notes — cross-window hover + notes sync.
 *
 * A second window is a *view* of the same project (ADR-11): the shared cursor and view
 * ride `uiState`. This checks both directions — hovering a chart in one window mirrors
 * onto the charts in the other — with a canvas heatmap in one window and a uPlot series
 * chart in the other, so both painter paths are exercised. See `docs/ui-layout.md`.
 */
import { analyzerPanel, tab } from "../support/selectors.ts";
import {
  canvasSignature,
  closeAllTabs,
  count,
  openFixture,
  openTool,
  rowSignature,
  waitFor,
  waitForAnalyzer,
  waitForApp,
} from "../support/helpers.ts";
import { closeWindowsMatching, windowLabels } from "../support/windows.ts";

/** Dispatch a hover at a fraction of the element's box (uPlot listens to `mousemove`). */
async function hover(selector: string, xFrac: number, yFrac: number): Promise<void> {
  await browser.execute(
    (sel: string, fx: number, fy: number) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error(`hover: no element for ${sel}`);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      for (const type of ["pointermove", "mousemove"]) {
        el.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
          }),
        );
      }
    },
    selector,
    xFrac,
    yFrac,
  );
  await browser.pause(300);
}

/** Right-click a tab and choose "Pop out to window" from dockview's context menu. */
async function popOut(id: string): Promise<string> {
  await browser.execute((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`popOut: no tab for ${sel}`);
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 2,
        buttons: 2,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
  }, tab(id));

  const before = await windowLabels();
  const items = await $$(".dv-context-menu-item");
  for (const item of items) {
    if ((await item.getText()).trim() === "Pop out to window") {
      await item.click();
      break;
    }
  }
  let label = "";
  await waitFor(async () => {
    label = (await windowLabels()).find((l) => !before.includes(l)) ?? "";
    return label !== "";
  }, "no popout window appeared");
  return label;
}

describe("N. Notes — cross-window cursor", () => {
  before(async () => {
    await waitForApp();
    await closeAllTabs();
  });

  after(async () => {
    await browser.tauri.switchWindow("main").catch(() => {});
    await closeWindowsMatching(/^popout-\d+$/);
  });

  it("mirrors the hovered cursor between the main window and a popout", async () => {
    await openFixture("sine440");
    // A canvas heatmap (its own painter) and a uPlot series chart (a plugin painter).
    await openTool("spectrogram");
    await waitForAnalyzer("spectrogram");
    await openTool("spectralCentroid");
    await waitForAnalyzer("spectralCentroid");
    await waitFor(
      async () => (await count(`${analyzerPanel("spectralCentroid")} canvas`)) > 0,
      "no series canvas",
    );

    // Send the spectrogram to its own window, leaving the series chart in `main`.
    const popout = await popOut("spectrogram");
    const heatmap = `${analyzerPanel("spectrogram")} canvas`;
    const series = `${analyzerPanel("spectralCentroid")} .u-over`;
    const seriesCanvas = series.replace(" .u-over", " canvas");

    // --- main → popout: hover the uPlot chart, the heatmap should follow ------------
    await browser.tauri.switchWindow("main");
    const seriesBefore = await canvasSignature(seriesCanvas);
    await hover(series, 0.3, 0.4);
    const seriesAfter = await canvasSignature(seriesCanvas);
    await browser.tauri.switchWindow(popout);
    const heatmapNear = await canvasSignature(heatmap);
    const leftMarker = heatmapNear;
    await browser.tauri.switchWindow("main");
    await hover(series, 0.8, 0.4);
    await browser.tauri.switchWindow(popout);
    const heatmapFar = await canvasSignature(heatmap);

    // --- popout → main: hover the heatmap, the uPlot chart should follow ------------
    await hover(heatmap, 0.25, 0.4);
    await browser.tauri.switchWindow("main");
    const seriesFromPopout = await canvasSignature(seriesCanvas);

    // …and it must keep up as that remote pointer *moves*. A watcher that tracked only
    // the message's tag (its group / sourceId — constant for one publisher) drew the
    // first position and then mirrored it forever: the popout's moves reached the canvas
    // heatmap (which reads the position while drawing) but not a uPlot chart.
    const mirrorBefore = await rowSignature(seriesCanvas);
    await browser.tauri.switchWindow(popout);
    await hover(heatmap, 0.7, 0.4);
    await browser.tauri.switchWindow("main");
    const mirrorAfter = await rowSignature(seriesCanvas);

    expect({
      // The hovered chart draws its own crosshair, so it repaints locally too.
      seriesRepainted: seriesBefore !== seriesAfter,
      heatmapFollowedTheSeries: heatmapNear !== heatmapFar,
      heatmapMovedMarker: leftMarker !== heatmapFar,
      seriesFollowedTheHeatmap: seriesFromPopout !== seriesAfter,
      seriesKeptUpWithTheSecondMove: mirrorAfter !== mirrorBefore,
    }).toEqual({
      seriesRepainted: true,
      heatmapFollowedTheSeries: true,
      heatmapMovedMarker: true,
      seriesFollowedTheHeatmap: true,
      seriesKeptUpWithTheSecondMove: true,
    });
  });
});
