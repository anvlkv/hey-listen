import raw from "../../story-assets/hero/manifest.json";

/**
 * The capture manifest (v3) and the mapping from its normalized coordinates to the
 * film frame.
 *
 * The captures are full-window screenshots of the app at `capture.width x
 * capture.height` CSS px, written at `dpr` (so 2880 x 1694). Rects and cursor points
 * are normalized to the *viewport*, never to the PNG, so every geometry helper here
 * goes through `APP_W` / `APP_H`.
 *
 * The PNG is shown full-bleed at 1600 px wide, which makes it 941 px tall: the film
 * frame is 900 px, so the bottom ~41 px of app space fall outside the frame. That is
 * deliberate (the landing crops the bottom third anyway) and keeps the window
 * title bar intact.
 */

export type Rect = {x: number; y: number; width: number; height: number};

export type CursorPoint = {
  /** CSS px inside the captured viewport. */
  x: number;
  y: number;
  /** Normalized 0-1, origin top-left. */
  nx: number;
  ny: number;
};

export type Frame = {
  image: string;
  imageSize: {width: number; height: number};
  atMs: number;
  rects: Record<string, Rect>;
  cursor?: CursorPoint;
};

export type Shot = {
  id: string;
  kind: "burst" | "still";
  theme: "dark" | "light";
  note?: string;
  /** Retimed length of the burst on the film timeline (holds afterwards). */
  seconds: number;
  frames: Frame[];
};

export type Manifest = {
  version: number;
  source: string;
  audio: string;
  loop: {sourceStart: number; sourceEnd: number; duration: number};
  capture: {width: number; height: number; dpr: number};
  shots: Shot[];
};

export const manifest = raw as unknown as Manifest;

export const FILM_W = 1600;
export const FILM_H = 900;

/** App content in composition px: the screenshot is scaled to fill the frame width. */
export const APP_W = FILM_W;
export const APP_H = (APP_W * manifest.capture.height) / manifest.capture.width;

const byId = new Map(manifest.shots.map((shot) => [shot.id, shot]));

export const getShot = (id: string): Shot | undefined => byId.get(id);

export const shotSrc = (image: string) => `hero/${image}`;

/**
 * Rect/cursor coordinates are normalized against the capture viewport, which is
 * shorter than some legacy PNGs (they carry ~28 CSS px of dead space at the
 * bottom). Everything is top-aligned, so the extra rows simply fall outside.
 */
export const toApp = (rect: Rect) => ({
  x: rect.x * APP_W,
  y: rect.y * APP_H,
  width: rect.width * APP_W,
  height: rect.height * APP_H,
});

/** Cursor position in composition px for a fractional frame of a burst. */
export const cursorPoint = (
  shot: Shot,
  progress: number,
): {x: number; y: number} | null => {
  const count = shot.frames.length;
  if (count === 0) return null;
  const clamped = Math.min(Math.max(progress, 0), count - 1);
  const index = Math.min(count - 1, Math.floor(clamped));
  const next = Math.min(count - 1, index + 1);
  const a = shot.frames[index].cursor;
  const b = shot.frames[next].cursor;
  if (!a && !b) return null;
  const from = a ?? b!;
  const to = b ?? a!;
  const blend = clamped - index;
  const nx = from.nx + (to.nx - from.nx) * blend;
  const ny = from.ny + (to.ny - from.ny) * blend;
  return {x: nx * APP_W, y: ny * APP_H};
};

/**
 * Fractional frame index of a burst at `seconds` into the shot. The last frame
 * holds for the rest of the scene.
 */
export const burstProgress = (shot: Shot, seconds: number): number => {
  const count = shot.frames.length;
  if (count <= 1) return 0;
  const t = Math.min(Math.max(seconds / shot.seconds, 0), 1);
  return t * (count - 1);
};
