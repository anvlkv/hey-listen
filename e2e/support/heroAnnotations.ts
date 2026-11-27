/**
 * UI-driven annotations for the hero film (M35.A).
 *
 * The capture does not load a saved `.heyl`: it opens the raw OGG and the agent's pins are
 * created **through the app's own UI**, as a visitor would:
 *
 *   right-click the chart → “Add annotation here” → write the markdown → Save.
 *
 * Each annotation attaches to the open chart (its `tool`), so the rail row carries the
 * frozen values and the chart's annotation lane gets a marker. The rail fills up along the
 * scenario; the final clean reload clears it for the loop.
 */
import { analyzerPanel } from "./selectors.ts";
import { click, count, waitFor } from "./dom.ts";

export interface HeroAnnotation {
  /** The analyzer whose chart the pin belongs to (and must be open). */
  tool: "spectralCentroid" | "chromagram" | "roughness";
  /** Position across the chart (view = the loop window). */
  fx: number;
  /** Markdown; the first line becomes the row's title. */
  body: string;
}

/** The pins the scenario adds, with the measured numbers from the agent's run. */
export const HERO_ANNOTATIONS = {
  loop: {
    tool: "spectralCentroid",
    fx: 0.003,
    body:
      "LOOP — 52.000 → 83.200 s (31.200 s)\n\n" +
      "Seam −0.97 / +1.01 dB; starts −37 dBFS in the dark lull and ends quiet in the airy pocket.",
  },
  statement: {
    tool: "spectralCentroid",
    fx: 0.128,
    body:
      "56.00 s — the statement enters\n\n" +
      "Level lifts +13 dB (−30.2 → −24.8 dBFS); centroid 553 → 337 Hz.",
  },
  bright: {
    tool: "spectralCentroid",
    fx: 0.218,
    body:
      "58.80 s — dark → bright\n\n" + "Centroid 549 → 1015 Hz in 0.1 s; peak 1941 Hz at 59.25 s.",
  },
  plunge: {
    tool: "spectralCentroid",
    fx: 0.348,
    body:
      "62.85 s — bright → dark\n\n" + "Centroid 371 → 229 → 165 Hz; darkest 129–145 Hz at 63.85 s.",
  },
  seam: {
    tool: "chromagram",
    fx: 0.997,
    body:
      "83.20 s — seam harmony\n\n" +
      "1 s chroma 0.64 vs 0.68; both edges unvoiced, so no sustained tone beats across the wrap.",
  },
  roughness: {
    tool: "roughness",
    fx: 0.518,
    body:
      "68.17 s — roughness peak\n\n" +
      "0.48 asper (uncalibrated); 24 bands × 24 rates, weighted at 70 Hz. Hover for the drill-down.",
  },
} as const;

/** Open a chart's reframe menu at a plot-relative point (uPlot over box, or the canvas). */
async function openChartMenuAt(tool: string, fx: number, fy = 0.5): Promise<void> {
  const selector = `${analyzerPanel(tool)} canvas`;
  await browser.execute(
    (sel: string, fx: number, fy: number) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      if (els.length === 0) throw new Error(`openChartMenuAt: no chart for ${sel}`);
      const over =
        (els[0].closest(".uplot")?.querySelector(".u-over") as HTMLElement | null) ?? null;
      const anchor = over ?? els[0];
      const rect = anchor.getBoundingClientRect();
      const clientX = rect.left + rect.width * fx;
      const clientY = rect.top + rect.height * fy;
      (over ?? els[0]).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          composed: true,
          button: 2,
          buttons: 2,
          clientX,
          clientY,
          view: window,
        }),
      );
    },
    selector,
    fx,
    fy,
  );
  await waitFor(async () => (await count(".reframe-menu")) > 0, "the chart menu did not open");
}

/** Add one annotation through the UI: menu → “Add annotation here” → markdown → Save. */
export async function annotate(annotation: HeroAnnotation): Promise<void> {
  await openChartMenuAt(annotation.tool, annotation.fx);

  const clicked = (await browser.execute(() => {
    const menu = document.querySelector(".reframe-menu");
    const button = Array.from(menu?.querySelectorAll("button") ?? []).find((item) =>
      (item.textContent ?? "").includes("Add annotation here"),
    ) as HTMLElement | undefined;
    button?.click();
    return !!button;
  })) as boolean;
  if (!clicked) throw new Error("the chart menu had no “Add annotation here” item");

  await waitFor(
    async () => (await count('[data-testid^="annotation.bodyInput."]')) > 0,
    "the annotation editor did not open",
  );
  await browser.execute((text: string) => {
    const field = document.querySelector(
      '[data-testid^="annotation.bodyInput."]',
    ) as HTMLTextAreaElement | null;
    if (!field) throw new Error("no annotation editor");
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  }, annotation.body);

  await click('[data-testid^="annotation.done."]');
  await waitFor(
    async () => (await count('[data-testid^="annotation.bodyInput."]')) === 0,
    "the annotation editor did not close",
  );
}
