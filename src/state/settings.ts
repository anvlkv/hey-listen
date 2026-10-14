import { createSignal } from "solid-js";

/**
 * UI settings (app-level chrome preferences).
 *
 * Currently just the **font scale** — a user-adjustable zoom for the whole interface
 * (text and text-bearing controls), default `1` (100%), clamped to 0.8–1.4 in 0.05
 * steps (plus the Source panel pin below).
 *
 * Font scale is applied by writing `--ui-scale` on the document root; `App.css`
 * derives the root `font-size` from it, and text rules use `rem` (1rem = scaled
 * root). We deliberately do **not** use CSS `zoom`/`transform`: those would break
 * the Timeline 2D-canvas device-pixel-ratio math, `dockview` drag coordinates, and
 * uPlot sizing.
 *
 * The **theme** moved to [`./themes`](themes.ts) in M11 (exchangeable theme files);
 * it applies `data-theme` + a `ui` overlay on the root. Font scale is persisted in
 * `localStorage` (read once at init, written on change) so it survives reloads.
 */

/** Smallest supported scale (80%). */
export const FONT_SCALE_MIN = 0.8;
/** Largest supported scale (140%). */
export const FONT_SCALE_MAX = 1.4;
/** Increment used by the `A−` / `A+` toolbar buttons. */
export const FONT_SCALE_STEP = 0.05;

const STORAGE_KEY = "hey-listen:font-scale";

/** Clamp to `[MIN, MAX]` and snap to the step grid (avoids float drift). */
function clampScale(value: number): number {
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
  const snapped = Math.round(clamped / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  return Number(snapped.toFixed(2));
}

function loadScale(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 1;
    const value = Number(raw);
    return Number.isFinite(value) ? clampScale(value) : 1;
  } catch {
    // Storage may be unavailable (e.g. private mode); fall back to the default.
    return 1;
  }
}

function applyFontScale(scale: number) {
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  }
}

const [fontScale, setFontScaleSignal] = createSignal(loadScale());

// Apply eagerly at module load so a persisted scale never flashes the default.
applyFontScale(fontScale());

/** Set the UI font scale (clamped to `[MIN, MAX]`, snapped to `STEP`). */
export function setFontScale(value: number) {
  const scale = clampScale(value);
  applyFontScale(scale);
  setFontScaleSignal(scale);
  try {
    localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    // Not persisting is fine; the scale still applies for this session.
  }
}

/** Nudge the scale by `direction` steps (e.g. `-1` / `+1`), clamped. */
export function nudgeFontScale(direction: number) {
  setFontScale(fontScale() + direction * FONT_SCALE_STEP);
}

/** Reset the scale back to the default (100%). */
export function resetFontScale() {
  setFontScale(1);
}

export { fontScale };

/**
 * Whether the Source panel is force-shown while a source already exists, so the
 * user can replace it. The panel is shown automatically when there is no source
 * or while recording (see `App.tsx`), so this is only the "reveal it anyway"
 * override — transient, not persisted.
 */
export const [sourcePanelPinned, setSourcePanelPinned] = createSignal(false);
