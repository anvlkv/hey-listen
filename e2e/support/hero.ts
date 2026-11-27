/**
 * Landing **hero film** capture support (M35.A).
 *
 * The film is a montage of **real app motion**, not a slideshow: each scene captures either
 * a still (with its normalized rects) or a short **burst** of frames while an interaction
 * runs — a crosshair sweep, a timeline zoom, the compare offset slide, MCP switching on.
 * Remotion plays the bursts and uses the rects to push into a named element, without knowing
 * the display's DPR.
 *
 * This module owns the parts that are easy to get subtly wrong: frame capture and rects,
 * the PNG size, pinning the analysis window + view, the app-level theme (with a restore),
 * and the interaction drivers the bursts use. The scenario lives in `e2e/hero/capture.spec.ts`.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { SEL, analyzerPanel, firstAnnotationRow } from "./selectors.ts";
import { click, count, waitFor, wheelOver } from "./dom.ts";
import { dismissPopovers } from "./popups.ts";
import { invokeCore } from "./ipc.ts";
import { hoverAt } from "./capture.ts";
import { canvasHasInk } from "./analyzers.ts";
import { openFileFixture, waitForSourceLoaded } from "./source.ts";

export type ThemeMode = "auto" | "dark" | "light";
export type ShotKind = "still" | "burst";

/** A rect as a fraction of the viewport: 0–1, origin top-left. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One captured frame of a clip. */
export interface HeroFrame {
  /** Path relative to the hero asset directory. */
  image: string;
  imageSize: { width: number; height: number };
  capturedAt: string;
  /** Milliseconds since the clip's first frame. */
  atMs: number;
  rects: Record<string, NormalizedRect>;
}

/**
 * A filmable clip: a still (one frame) or a burst (a short interaction).
 *
 * `seconds` is the intended on-screen time for the motion — the composition retimes the
 * frames to it; `fps` is the measured capture rate, for reference.
 */
export interface HeroShot {
  id: string;
  kind: ShotKind;
  theme: Exclude<ThemeMode, "auto">;
  note: string;
  seconds: number;
  capturedMs: number;
  fps: number;
  viewport: { width: number; height: number };
  dpr: number;
  frames: HeroFrame[];
}

export interface HeroManifestMeta {
  project: string;
  /** The full track the Timeline shows (the project's source). */
  source: string;
  /** The 31.2 s loop the film plays. */
  audio: string;
  loop: { sourceStart: number; sourceEnd: number; duration: number };
  analysis: string[];
  /** The reference window the compare scene opened, when it ran. */
  compare?: { source: string; window: [number, number]; tool: string };
}

/** The chrome and regions every frame records (first match; absent when not rendered). */
const BASE_RECTS: Record<string, string> = {
  app: SEL.app,
  toolbar: SEL.toolbar,
  activitybar: SEL.activitybar,
  sidebar: SEL.sidebar,
  workbench: SEL.workbench,
  timeline: SEL.timeline,
  "timeline.canvas": SEL.timelineCanvas,
  source: SEL.source,
  annotations: SEL.annotationsRegion,
  "annotations.rows": SEL.annotationsRows,
  "first.annotation": firstAnnotationRow,
  export: SEL.exportRegion,
  "graph.canvas": SEL.graphCanvas,
  "toolbar.mcp": SEL.toolbarMcp,
  "toolbar.appearance": SEL.toolbarView,
};

/** The analyzer panel + its first canvas, as extra rects for one clip. */
export function analyzerRects(id: string): Record<string, string> {
  return {
    [`analyzer.${id}`]: analyzerPanel(id),
    [`analyzer.${id}.canvas`]: `${analyzerPanel(id)} canvas`,
  };
}

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
  await hoverAt(`${analyzerPanel(id)} canvas`, fx, fy);
  await browser.pause(150);
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

/** The viewport's CSS size and device pixel ratio. */
async function readViewport(): Promise<{ width: number; height: number; dpr: number }> {
  return (await browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  }))) as { width: number; height: number; dpr: number };
}

/** Read normalized rects for `selectors` (first match each; absent when not rendered). */
async function readRects(
  selectors: Record<string, string>,
): Promise<Record<string, NormalizedRect>> {
  const names = Object.keys(selectors);
  const values = Object.values(selectors);
  return (await browser.execute(
    (names: string[], values: string[]) => {
      const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
      const width = window.innerWidth;
      const height = window.innerHeight;
      for (let index = 0; index < names.length; index += 1) {
        const element = document.querySelector(values[index] ?? "");
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        out[names[index] ?? ""] = {
          x: Math.max(0, Math.min(1, rect.left / width)),
          y: Math.max(0, Math.min(1, rect.top / height)),
          width: Math.max(0, Math.min(1, rect.width / width)),
          height: Math.max(0, Math.min(1, rect.height / height)),
        };
      }
      return out;
    },
    names,
    values,
  )) as Record<string, NormalizedRect>;
}

/** A PNG's pixel size from its IHDR header (bytes 16–24), independent of DPR. */
async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const header = (await readFile(file)).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** Screenshot the window into `<dir>/shots/<base>.png` and read its rects. */
async function takeFrame(
  dir: string,
  base: string,
  extraRects?: Record<string, string>,
): Promise<Omit<HeroFrame, "atMs">> {
  // A synthetic click's focus ring must not frame the shot; blur whatever is focused.
  await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
  const file = path.join(dir, "shots", `${base}.png`);
  await browser.saveScreenshot(file);
  return {
    image: `shots/${base}.png`,
    imageSize: await pngSize(file),
    capturedAt: new Date().toISOString(),
    rects: await readRects({ ...BASE_RECTS, ...(extraRects ?? {}) }),
  };
}

export interface CaptureInput {
  id: string;
  theme: Exclude<ThemeMode, "auto">;
  note: string;
  /** Intended on-screen seconds (0/omitted for a still). */
  seconds?: number;
  /** Extra `name → selector` rects to record for this clip. */
  extraRects?: Record<string, string>;
  /** Extra settle time before the (single) frame, in ms. */
  settleMs?: number;
}

/** Capture a single **still** clip. */
export async function captureHeroShot(dir: string, input: CaptureInput): Promise<HeroShot> {
  await browser.pause(input.settleMs ?? 300);
  const viewport = await readViewport();
  const frame = { ...(await takeFrame(dir, input.id, input.extraRects)), atMs: 0 };
  return {
    id: input.id,
    kind: "still",
    theme: input.theme,
    note: input.note,
    seconds: input.seconds ?? 0,
    capturedMs: 0,
    fps: 0,
    viewport: { width: viewport.width, height: viewport.height },
    dpr: viewport.dpr,
    frames: [frame],
  };
}

export interface BurstInput extends Omit<CaptureInput, "settleMs"> {
  /** How many frames to capture. */
  frames: number;
  /** Pause between a frame's interaction and its screenshot, in ms. */
  intervalMs?: number;
  /** The interaction to drive before frame `index` (0-based). */
  act: (index: number, total: number) => Promise<void>;
}

/**
 * Capture a **burst**: drive `act(index)` then screenshot, `frames` times.
 *
 * This is what makes the film move: the frames are consecutive states of one real
 * interaction, so Remotion plays them (retimed to `seconds`) instead of faking a push-in.
 */
export async function captureHeroBurst(dir: string, input: BurstInput): Promise<HeroShot> {
  const viewport = await readViewport();
  const frames: HeroFrame[] = [];
  const started = Date.now();
  for (let index = 0; index < input.frames; index += 1) {
    await input.act(index, input.frames);
    if (input.intervalMs) await browser.pause(input.intervalMs);
    const frame = await takeFrame(
      dir,
      `${input.id}-${String(index).padStart(2, "0")}`,
      input.extraRects,
    );
    frames.push({ ...frame, atMs: Date.now() - started });
  }
  const capturedMs = Date.now() - started;
  return {
    id: input.id,
    kind: "burst",
    theme: input.theme,
    note: input.note,
    seconds: input.seconds ?? capturedMs / 1000,
    capturedMs,
    fps: frames.length / Math.max(capturedMs / 1000, 0.001),
    viewport: { width: viewport.width, height: viewport.height },
    dpr: viewport.dpr,
    frames,
  };
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
    await hoverAt(canvas, fx0 + (fx1 - fx0) * t, fy0 + (fy1 - fy0) * t, settleMs);
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

/** Write `manifest.json` for the clips captured so far (safe to call repeatedly). */
export async function writeHeroManifest(
  dir: string,
  shots: HeroShot[],
  meta: HeroManifestMeta,
): Promise<void> {
  const manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    project: meta.project,
    source: meta.source,
    audio: meta.audio,
    loop: meta.loop,
    analysis: meta.analysis,
    compare: meta.compare ?? null,
    capture: shots[0]
      ? { width: shots[0].viewport.width, height: shots[0].viewport.height, dpr: shots[0].dpr }
      : null,
    shots,
  };
  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
