import { createSignal } from "solid-js";

/**
 * Chart-image provider registry (M12).
 *
 * A chart view registers how to reach its **rendered** canvas, so the tab's Export
 * action can save a PNG that matches what the user sees (theme, zoom, visible range)
 * without a DOM-screenshot dependency. The registry is reactive: a provider appears
 * when its tab mounts and disappears on cleanup, so the Export menu can enable
 * "Chart PNG" only when a chart is actually drawn. See `docs/exports.md`.
 *
 * The uPlot-backed views expose `zoom.instance()?.ctx.canvas`; the plain-canvas
 * heatmaps expose their own canvas. Readouts (levels / LUFS / LRA) have no chart and
 * register nothing.
 */
export type ChartImageProvider = () => HTMLCanvasElement | null;

const [providers, setProviders] = createSignal<Record<string, ChartImageProvider>>({});

/** Register (or clear, with `null`) the canvas provider for one tool id. */
export function registerChartImage(tool: string, provider: ChartImageProvider | null): void {
  setProviders((previous) => {
    if (provider == null) {
      if (!(tool in previous)) return previous;
      const next = { ...previous };
      delete next[tool];
      return next;
    }
    return { ...previous, [tool]: provider };
  });
}

/** Clear a provider only if it is still the one a component registered. */
export function unregisterChartImage(tool: string, provider: ChartImageProvider): void {
  if (providers()[tool] === provider) registerChartImage(tool, null);
}

/** Whether `tool` currently has a rendered chart to capture (reactive). */
export function hasChartImage(tool: string): boolean {
  return providers()[tool]?.() != null;
}

/** The live canvas for `tool`, or `null` when it has no chart / is not ready. */
export function chartCanvas(tool: string): HTMLCanvasElement | null {
  return providers()[tool]?.() ?? null;
}

/**
 * Capture `tool`'s chart as a PNG blob. The output is at least 2× the CSS size, so a
 * standard-density display still gets a crisp file; on a retina display the canvas
 * backing store is already 2×, so it is copied 1:1 instead of upscaled.
 */
export async function chartPng(tool: string): Promise<Blob | null> {
  const source = chartCanvas(tool);
  if (!source || source.width === 0 || source.height === 0) return null;

  const targetWidth = Math.max(source.width, Math.round(source.clientWidth * 2), 1);
  const scale = targetWidth / source.width;
  const output = document.createElement("canvas");
  output.width = targetWidth;
  output.height = Math.max(1, Math.round(source.height * scale));

  const ctx = output.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, output.width, output.height);
  return new Promise((resolve) => output.toBlob((blob) => resolve(blob), "image/png"));
}
