/**
 * Landing **hero film** capture primitives (M35.A): frames, shots and the manifest.
 *
 * The scenario drives the app through public helpers in `hero.ts`; this module owns the
 * low-level parts of turning the window into film assets — a **viewport-cropped** screenshot,
 * the named regions' normalized rects, the annotation rows, the hovered **cursor** point, and
 * the manifest. Frames are `viewport × dpr` exactly: `saveScreenshot` returns the whole
 * native window, ~28 CSS px taller than `window.innerHeight` on macOS, so the flat strip
 * below the app is cropped off the top-left.
 */
import { execFileSync } from "node:child_process";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";

import { SEL, analyzerPanel, firstAnnotationRow } from "./selectors.ts";
import { hoverAt } from "./capture.ts";

export type ThemeMode = "auto" | "dark" | "light";
export type ShotKind = "still" | "burst";

/** A rect as a fraction of the viewport: 0–1, origin top-left. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the capture put the pointer on this frame, for drawing a synthetic cursor.
 *
 * The app paints no cursor, so the composition cannot find one in the pixels; recording
 * the hovered point lets Remotion draw a cursor that lands on the crosshair/tooltip the
 * frame actually shows. `x`/`y` are CSS px in the page; `nx`/`ny` are viewport fractions.
 */
export interface HeroCursor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** One captured frame of a clip. */
export interface HeroFrame {
  /** Path relative to the hero asset directory. */
  image: string;
  /** Exactly `viewport × dpr` (the window-chrome pad is cropped off). */
  imageSize: { width: number; height: number };
  capturedAt: string;
  /** Milliseconds since the clip's first frame. */
  atMs: number;
  rects: Record<string, NormalizedRect>;
  /** The cursor position the scenario hovered, when it hovered something. */
  cursor?: HeroCursor;
  /** The annotation rail's rows, top to bottom (empty until the first pin). */
  rows?: NormalizedRect[];
}

export interface HeroShot {
  id: string;
  kind: ShotKind;
  theme: Exclude<ThemeMode, "auto">;
  note: string;
  seconds: number;
  capturedMs: number;
  /** Measured capture rate (wall clock), for reference only — retime by `seconds`. */
  fps: number;
  /** Frames per film second (`frames.length / seconds`), for reference. */
  nominalFps: number;
  viewport: { width: number; height: number };
  dpr: number;
  /**
   * When this shot opens a theme dissolve, the id of the previous shot whose **last**
   * frame it dissolves from (always a same-state pair that differs only by palette).
   */
  dissolveFrom?: string;
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
  // The export rail's run button (M43), so the film can push into the action.
  "export.run": SEL.exportRun,
  "graph.canvas": SEL.graphCanvas,
  "toolbar.mcp": SEL.toolbarMcp,
  "toolbar.appearance": SEL.toolbarView,
  // The MCP popover's switch (visible only while the popover is open).
  "mcp.switch": ".pop-panel .toolbar-switch-control",
};

/** The analyzer panel + its first canvas, as extra rects for one clip. */
export function analyzerRects(id: string): Record<string, string> {
  return {
    [`analyzer.${id}`]: analyzerPanel(id),
    [`analyzer.${id}.canvas`]: `${analyzerPanel(id)} canvas`,
  };
}

/** The viewport's CSS size and device pixel ratio. */
export async function readViewport(): Promise<{ width: number; height: number; dpr: number }> {
  return (await browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  }))) as { width: number; height: number; dpr: number };
}

/** The pointer the last hover put down; every subsequent frame records it as `cursor`. */
let lastCursor: HeroCursor | null = null;

/** Record the cursor a hover landed on. */
function setCursor(cursor: HeroCursor | null): void {
  lastCursor = cursor;
}

/**
 * Hover an element **and remember where**, so the frame records a drawable cursor.
 *
 * This is `hoverAt` plus the bookkeeping the film needs: `hoverAt` returns the CSS-px
 * point it dispatched, and this normalizes it to the viewport for the manifest.
 */
export async function hoverAndRecord(
  selector: string,
  fx = 0.5,
  fy = 0.5,
  settleMs = 200,
): Promise<void> {
  const { x, y } = await hoverAt(selector, fx, fy, settleMs);
  const viewport = await readViewport();
  setCursor({ x, y, nx: x / viewport.width, ny: y / viewport.height });
}

/**
 * Read normalized rects for `selectors` (first match each) and the annotation rail's rows,
 * in one in-page pass so both share the same normalization (`0–1`, origin top-left).
 */
async function readFrameRects(
  selectors: Record<string, string>,
): Promise<{ rects: Record<string, NormalizedRect>; rows: NormalizedRect[] }> {
  const names = Object.keys(selectors);
  const values = Object.values(selectors);
  return (await browser.execute(
    (names: string[], values: string[]) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const norm = (rect: DOMRect) => ({
        x: Math.max(0, Math.min(1, rect.left / width)),
        y: Math.max(0, Math.min(1, rect.top / height)),
        width: Math.max(0, Math.min(1, rect.width / width)),
        height: Math.max(0, Math.min(1, rect.height / height)),
      });
      const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
      for (let index = 0; index < names.length; index += 1) {
        const element = document.querySelector(values[index] ?? "");
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        rects[names[index] ?? ""] = norm(rect);
      }
      const rows = Array.from(document.querySelectorAll('[data-testid^="annotation.row."]')).map(
        (el) => norm(el.getBoundingClientRect()),
      );
      return { rects, rows };
    },
    names,
    values,
  )) as { rects: Record<string, NormalizedRect>; rows: NormalizedRect[] };
}

/** A PNG's pixel size from its IHDR header (bytes 16–24), without reading the whole file. */
async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(24);
    await handle.read(header, 0, 24, 0);
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

/**
 * Crop a window screenshot down to the **web viewport** (`viewport × dpr`, top-left).
 * Only ever crops; a smaller image is left untouched with a warning.
 */
function cropToViewport(
  file: string,
  viewport: { width: number; height: number; dpr: number },
  actual: { width: number; height: number },
): void {
  const width = Math.round(viewport.width * viewport.dpr);
  const height = Math.round(viewport.height * viewport.dpr);
  if (actual.width === width && actual.height === height) return;
  if (actual.width < width || actual.height < height) {
    console.warn(
      `hero: "${file}" is ${actual.width}×${actual.height}, smaller than the viewport ${width}×${height}; keeping it`,
    );
    return;
  }
  try {
    execFileSync("magick", [file, "-crop", `${width}x${height}+0+0`, "+repage", file]);
  } catch (err) {
    console.warn(
      `hero: could not crop "${file}" to ${width}×${height}; keeping the window shot:`,
      err,
    );
  }
}

/** Screenshot the window into `<dir>/shots/<base>.png` and read its rects, rows and cursor. */
async function takeFrame(
  dir: string,
  base: string,
  viewport: { width: number; height: number; dpr: number },
  extraRects?: Record<string, string>,
): Promise<Omit<HeroFrame, "atMs">> {
  // A synthetic click's focus ring must not frame the shot; blur whatever is focused.
  await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
  const file = path.join(dir, "shots", `${base}.png`);
  await browser.saveScreenshot(file);
  cropToViewport(file, viewport, await pngSize(file));
  const { rects, rows } = await readFrameRects({ ...BASE_RECTS, ...(extraRects ?? {}) });
  return {
    image: `shots/${base}.png`,
    imageSize: await pngSize(file),
    capturedAt: new Date().toISOString(),
    rects,
    ...(lastCursor ? { cursor: lastCursor } : {}),
    ...(rows.length > 0 ? { rows } : {}),
  };
}

export interface CursorTarget {
  /** Element to hover (the pointer is recorded at its box, like `hoverAt`). */
  selector: string;
  fx?: number;
  fy?: number;
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
  /**
   * Hover this element just before the (still) frame, so it records a `cursor` on a
   * meaningful target. Without it a still keeps the previous shot's pointer.
   */
  cursor?: CursorTarget;
  /** The shot whose **last** frame this one dissolves from (a same-state theme pair). */
  dissolveFrom?: string;
}

/** Capture a single **still** clip (a supplied `cursor` is hovered first). */
export async function captureHeroShot(dir: string, input: CaptureInput): Promise<HeroShot> {
  if (input.cursor) {
    await hoverAndRecord(input.cursor.selector, input.cursor.fx, input.cursor.fy, 0);
  }
  await browser.pause(input.settleMs ?? 300);
  const viewport = await readViewport();
  const frame = { ...(await takeFrame(dir, input.id, viewport, input.extraRects)), atMs: 0 };
  return {
    id: input.id,
    kind: "still",
    theme: input.theme,
    note: input.note,
    seconds: input.seconds ?? 0,
    capturedMs: 0,
    fps: 0,
    nominalFps: 0,
    viewport: { width: viewport.width, height: viewport.height },
    dpr: viewport.dpr,
    ...(input.dissolveFrom ? { dissolveFrom: input.dissolveFrom } : {}),
    frames: [frame],
  };
}

export interface BurstInput extends Omit<CaptureInput, "settleMs" | "cursor"> {
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
      viewport,
      input.extraRects,
    );
    frames.push({ ...frame, atMs: Date.now() - started });
  }
  const capturedMs = Date.now() - started;
  const seconds = input.seconds ?? capturedMs / 1000;
  return {
    id: input.id,
    kind: "burst",
    theme: input.theme,
    note: input.note,
    seconds,
    capturedMs,
    fps: frames.length / Math.max(capturedMs / 1000, 0.001),
    nominalFps: seconds > 0 ? frames.length / seconds : 0,
    viewport: { width: viewport.width, height: viewport.height },
    dpr: viewport.dpr,
    ...(input.dissolveFrom ? { dissolveFrom: input.dissolveFrom } : {}),
    frames,
  };
}

/** Write `manifest.json` for the clips captured so far (safe to call repeatedly). */
export async function writeHeroManifest(
  dir: string,
  shots: HeroShot[],
  meta: HeroManifestMeta,
): Promise<void> {
  const manifest = {
    version: 3,
    generatedAt: new Date().toISOString(),
    project: meta.project,
    source: meta.source,
    audio: meta.audio,
    loop: meta.loop,
    analysis: meta.analysis,
    compare: meta.compare ?? null,
    capture: shots[0]
      ? {
          width: shots[0].viewport.width,
          height: shots[0].viewport.height,
          dpr: shots[0].dpr,
          /** Every PNG is exactly `width × dpr` by `height × dpr` (chrome pad cropped). */
          imageWidth: Math.round(shots[0].viewport.width * shots[0].dpr),
          imageHeight: Math.round(shots[0].viewport.height * shots[0].dpr),
        }
      : null,
    // The theme dissolves, derived from each shot's `dissolveFrom` — explicit, not implied.
    dissolves: shots
      .filter((shot) => shot.dissolveFrom)
      .map((shot) => ({ from: shot.dissolveFrom, to: shot.id })),
    shots,
  };
  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
