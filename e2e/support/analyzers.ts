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
 * A coarse signature of a selector's first canvas, for "did it repaint" checks.
 *
 * Samples every 97th pixel: cheap enough for a full-size chart canvas (a real
 * `getImageData` over 1816×1228 is ~9 MB of pixels), while still changing whenever
 * anything visible is drawn. `"none"` means the canvas is missing or zero-sized.
 */
export async function canvasSignature(selector: string): Promise<string> {
  return (await browser.execute((sel: string) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || c.width === 0) return "none";
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let hash = 0;
    for (let i = 0; i < data.length; i += 4 * 97) {
      hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) | 0;
    }
    return `${c.width}x${c.height}:${hash}`;
  }, selector)) as string;
}

/**
 * A signature of a **band of rows** across a selector's first canvas.
 *
 * A full-height rule (the mirrored cursor, the preview playhead, a note's rule) only
 * occupies a couple of pixels, which the sparse sample of [`canvasSignature`] can miss
 * entirely — so this reads a band of rows instead of one. A **band** (rather than a single
 * row) because the mirrored cursor is *dashed*: a dashed rule's on/off phase is fixed
 * relative to the plot, so one row can sit in a gap for every position of the line. Eight
 * consecutive rows always cover a `[4, 4]` dash cycle. `"none"` means no canvas.
 */
export async function rowSignature(selector: string): Promise<string> {
  return (await browser.execute((sel: string) => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || c.width === 0) return "none";
    const { data } = ctx.getImageData(0, Math.max(0, Math.floor(c.height / 2) - 4), c.width, 8);
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) | 0;
    }
    return `${c.width}:${hash}`;
  }, selector)) as string;
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
