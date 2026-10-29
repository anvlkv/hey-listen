/**
 * U. Analysis exports (M12).
 *
 * Drives the per-tab Export popover against the real core: a spectrum's CSV (plus its
 * provenance sidecar) and the rendered chart's PNG. The native save dialog is stubbed
 * with `mockReturn`; the files themselves are written by the real `write_text` /
 * `write_bytes` commands, so the test reads them back from disk.
 *
 * Sorts between `s-project-ux` and `t-close-main` (which must stay last).
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyzerPanel } from "../support/selectors.ts";
import {
  closeAllTabs,
  mockReturn,
  openFixture,
  openTool,
  waitFor,
  waitForAnalyzer,
  waitForApp,
} from "../support/helpers.ts";

describe("U. Analysis exports (M12)", () => {
  const stem = path.join(os.tmpdir(), `heylisten-e2e-export-${Date.now()}`);

  before(async () => {
    await waitForApp();
    await closeAllTabs();
    await openFixture("chirpNoise");
    await openTool("spectrum");
    await waitForAnalyzer("spectrum");
  });

  after(() => {
    for (const extension of [".csv", ".meta.json", ".png"]) {
      rmSync(`${stem}${extension}`, { force: true });
    }
  });

  it("U1 — exports CSV + sidecar and the chart PNG", async () => {
    const panel = analyzerPanel("spectrum");
    await (await $(`${panel} [data-testid="analyzer.export.spectrum"]`)).click();

    // Data → CSV… (the dialog is stubbed to the temp path).
    const csv = `${stem}.csv`;
    await mockReturn("pick_save_path", csv);
    await (await $('[data-testid="export.csv"]')).click();
    await waitFor(() => Promise.resolve(existsSync(csv)), "the CSV export was never written");
    const lines = readFileSync(csv, "utf8").split("\n");
    expect(lines[0]).toBe("freq_hz,mean_db,min_db,max_db");
    expect(lines.length).toBeGreaterThan(1);

    // The sidecar is the envelope minus `result`.
    const meta = `${stem}.meta.json`;
    expect(existsSync(meta)).toBe(true);
    const envelope = JSON.parse(readFileSync(meta, "utf8"));
    expect(envelope.kind).toBe("hey-listen.analysis");
    expect(envelope.tool).toBe("spectrum");
    expect(envelope.result).toBeUndefined();
    expect(envelope.window.startSecs).toBeGreaterThanOrEqual(0);

    // Chart → PNG… — the bytes come from the rendered canvas.
    const png = `${stem}.png`;
    await mockReturn("pick_save_path", png);
    await (await $('[data-testid="export.png"]')).click();
    await waitFor(() => Promise.resolve(existsSync(png)), "the PNG export was never written");
    const signature = readFileSync(png).subarray(0, 4);
    expect([...signature]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
