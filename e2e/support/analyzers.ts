/**
 * Analyzer results (M8): wait for a tool to render, and read its readouts/canvas.
 */
import { analyzerPanel } from "./selectors.ts";
import { count, countWithin } from "./dom.ts";

/** Wait until an analyzer has a rendered result (or surfaced an error). */
export async function waitForAnalyzer(id: string, timeout = 60_000): Promise<void> {
  const scope = analyzerPanel(id);
  await browser.waitUntil(
    async () => {
      if ((await count(scope)) === 0) return false;
      if ((await countWithin(scope, ".analyzer-error")) > 0) return true;
      if ((await countWithin(scope, '[data-testid="analyzer.busy"]')) > 0) return false;
      const empty = await countWithin(scope, ".analyzer-empty");
      const canvas = await countWithin(scope, "canvas");
      const readouts = await countWithin(scope, ".readout-value");
      return empty === 0 && (canvas > 0 || readouts > 0);
    },
    { timeout, timeoutMsg: `analyzer "${id}" never rendered a result` },
  );
}

/** Wait until a readout-only analyzer renders its `.readout-card` values. */
export async function waitForReadouts(id: string, timeout = 60_000): Promise<void> {
  const scope = analyzerPanel(id);
  await browser.waitUntil(
    async () => {
      if ((await count(scope)) === 0) return false;
      if ((await countWithin(scope, '[data-testid="analyzer.busy"]')) > 0) return false;
      return (await countWithin(scope, ".readout-card-value")) > 0;
    },
    { timeout, timeoutMsg: `analyzer "${id}" never rendered its readouts` },
  );
}

/** The current value of a labeled readout inside an analyzer panel. */
export async function readoutValue(id: string, label: string): Promise<string | null> {
  return (await browser.execute(
    (scope: string, wanted: string) => {
      const root = document.querySelector(scope);
      if (!root) return null;
      for (const r of Array.from(root.querySelectorAll(".readout"))) {
        const name = r.querySelector(".readout-label")?.textContent?.trim();
        if (name === wanted) return r.querySelector(".readout-value")?.textContent?.trim() ?? null;
      }
      return null;
    },
    analyzerPanel(id),
    label,
  )) as string | null;
}

/** The value of a labeled readout card (levels, tempo, loudness…) inside a panel. */
export async function cardValue(id: string, label: string): Promise<string | null> {
  return (await browser.execute(
    (scope: string, wanted: string) => {
      const root = document.querySelector(scope);
      if (!root) return null;
      for (const c of Array.from(root.querySelectorAll(".readout-card"))) {
        const name = c.querySelector(".readout-card-label")?.textContent?.trim();
        if (name === wanted)
          return c.querySelector(".readout-card-value")?.textContent?.trim() ?? null;
      }
      return null;
    },
    analyzerPanel(id),
    label,
  )) as string | null;
}

/**
 * True when a canvas (scoped to `scope` when given) has drawn something over its
 * own background — the "renders non-empty" check the smoke tests use.
 */
export async function canvasHasInk(selector: string): Promise<boolean> {
  return (await browser.execute((sel: string) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!c) return false;
    const ctx = c.getContext("2d");
    if (!ctx || c.width === 0 || c.height === 0) return false;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const r0 = data[0];
    const g0 = data[1];
    const b0 = data[2];
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0) return true;
    }
    return false;
  }, selector)) as boolean;
}
