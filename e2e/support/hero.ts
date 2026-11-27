/**
 * Landing **hero film** scenario helpers (M35.A).
 *
 * The film is a montage of **real app motion**, not a slideshow: each scene captures either
 * a still (with its normalized rects) or a short **burst** of frames while an interaction
 * runs — a crosshair sweep, a timeline zoom, MCP switching on. Remotion plays the bursts and
 * uses the rects to push into a named element, without knowing the display's DPR.
 *
 * This module owns the parts the scenario drives: the app theme (with a restore), pinning
 * the analysis window + view, the interaction drivers, and the cursor-aware hover. The
 * frame/shot/manifest primitives live in `heroCapture.ts` and are re-exported here so the
 * scenario imports one module.
 */
import { SEL, analyzerPanel } from "./selectors.ts";
import { click, count, waitFor, wheelOver } from "./dom.ts";
import { dismissPopovers } from "./popups.ts";
import { invokeCore } from "./ipc.ts";
import { canvasHasInk } from "./analyzers.ts";
import { openFileFixture, waitForSourceLoaded } from "./source.ts";
import { hoverAndRecord } from "./heroCapture.ts";
import type { ThemeMode } from "./heroCapture.ts";

export {
  analyzerRects,
  captureHeroBurst,
  captureHeroShot,
  writeHeroManifest,
} from "./heroCapture.ts";
export type { HeroManifestMeta, HeroShot } from "./heroCapture.ts";

/** Open the original audio as a fresh project's source and wait for it to settle. */
export async function openAudioSource(file: string): Promise<void> {
  await openFileFixture(file);
  await waitForSourceLoaded(120_000);
}

/** Capture at 100 % UI scale so a developer's persisted zoom cannot shift the crops. */
export async function pinUiScale(): Promise<void> {
  await browser.execute(() => {
    try {
      localStorage.setItem("hey-listen:font-scale", "1");
    } catch {
      // Read-only storage is fine; the CSS variable below still applies.
    }
    document.documentElement.style.setProperty("--ui-scale", "1");
  });
}

/** Open the Annotations rail (app-level state may leave it closed on a fresh launch). */
export async function ensureAnnotationsRail(): Promise<void> {
  if ((await count(SEL.annotationsRegion)) > 0) return;
  await click(SEL.toolbarAnnotations);
  await waitFor(
    async () => (await count(SEL.annotationsRegion)) > 0,
    "the annotations rail did not open",
  );
}

/** Wait for a chart, then put the crosshair at `fx` (a still's preparation). */
export async function chartAt(id: string, fx: number, fy = 0.5): Promise<void> {
  await ensureChartInk(id);
  await heroHover(`${analyzerPanel(id)} canvas`, fx, fy, 150);
}

/**
 * Hover an element **and remember where**, so the frame records a drawable cursor.
 *
 * `hoverAt` dispatches no trusted pointer, and the app paints none; recording the point
 * lets the composition draw a cursor that lands on the crosshair/tooltip the frame shows.
 */
export async function heroHover(
  selector: string,
  fx = 0.5,
  fy = 0.5,
  settleMs = 200,
): Promise<void> {
  await hoverAndRecord(selector, fx, fy, settleMs);
}

/** The persisted preference mode (`hey-listen:theme` → `mode`), defaulting to `auto`. */
export async function storedMode(): Promise<ThemeMode> {
  const mode = (await browser.execute(() => {
    try {
      const raw = localStorage.getItem("hey-listen:theme");
      const parsed = raw ? (JSON.parse(raw) as { mode?: string }) : null;
      return parsed?.mode ?? "auto";
    } catch {
      return "auto";
    }
  })) as string;
  return mode === "dark" || mode === "light" ? mode : "auto";
}

/** Pick a stored theme mode through the Toolbar's Appearance popover (as a visitor would). */
export async function setThemeMode(label: "Auto" | "Dark" | "Light"): Promise<void> {
  if ((await storedMode()) === label.toLowerCase()) return;
  await dismissPopovers();
  await click(SEL.toolbarView);
  await waitFor(async () => (await count(".pop-panel")) > 0, "the Appearance popover did not open");
  await click(`.pop-panel [aria-label="${label} mode"]`);
  await waitFor(
    async () => (await storedMode()) === label.toLowerCase(),
    `the theme mode did not become ${label}`,
  );
  await dismissPopovers();
  // A palette swap repaints every canvas; let it settle before the next capture.
  await browser.pause(350);
}

/**
 * Pin the analysis window to the loop while keeping the Timeline **view** wider.
 *
 * The charts plot the window, so equal view and window make the crosshair positions in the
 * scenario (`fx = (event − start) / duration`) line up with the measured events. The Timeline
 * can still show the whole source (`view` = 0…duration) with the loop window highlighted.
 */
export async function pinLoop(
  start: number,
  end: number,
  view: { start: number; end: number } = { start, end },
): Promise<void> {
  await invokeCore("set_ui_state", {
    key: "timeline",
    value: {
      windowStart: start,
      windowEnd: end,
      viewStart: view.start,
      viewEnd: view.end,
    },
  });
  await browser.pause(300);
}

/** Wait until an analyzer's chart has drawn ink (call once before a sweep burst). */
export async function ensureChartInk(id: string): Promise<void> {
  const canvas = `${analyzerPanel(id)} canvas`;
  await browser.waitUntil(async () => canvasHasInk(canvas), {
    timeout: 30_000,
    timeoutMsg: `the "${id}" chart never drew anything`,
  });
}

/**
 * An interaction that sweeps an analyzer's crosshair from `(fx0, fy0)` to `(fx1, fy1)`.
 *
 * `fx`/`fy` are fractions of the chart box; with view = window, `fx` maps to film time.
 */
export function sweepChart(
  id: string,
  fx0: number,
  fx1: number,
  fy0 = 0.5,
  fy1 = 0.5,
  settleMs = 40,
): (index: number, total: number) => Promise<void> {
  const canvas = `${analyzerPanel(id)} canvas`;
  return async (index, total) => {
    const t = total <= 1 ? 0 : index / (total - 1);
    await heroHover(canvas, fx0 + (fx1 - fx0) * t, fy0 + (fy1 - fy0) * t, settleMs);
  };
}

/** An interaction that zooms the Timeline **view** out (or in) on each frame after the first. */
export function zoomTimeline(deltaY = 60, pauseMs = 40): (index: number) => Promise<void> {
  return async (index) => {
    if (index === 0) return; // frame 0 is the starting view
    await wheelOver(SEL.timelineCanvas, deltaY);
    await browser.pause(pauseMs);
  };
}
