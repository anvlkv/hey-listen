import { createSignal } from "solid-js";

/**
 * UI settings (app-level chrome preferences).
 *
 * Currently just the **font scale** — a user-adjustable zoom for the whole interface
 * (text and text-bearing controls), default `1` (100%), clamped to 0.8–1.4 in 0.05
 * steps (plus the Source panel pin below).
 *
 * Font scale is applied by writing `--ui-scale` on the document root; `src/styles/`
 * derives the root `font-size` from it, and text rules use `rem` (1rem = scaled
 * root). We deliberately do **not** use CSS `zoom`/`transform`: those would break
 * the Timeline 2D-canvas device-pixel-ratio math, `dockview` drag coordinates, and
 * uPlot sizing.
 *
 * The **theme** moved to [`./themes`](themes/index.ts) in M11 (exchangeable theme files);
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

const initialScale = loadScale();

const [fontScale, setFontScaleSignal] = createSignal(initialScale);

// Apply eagerly at module load so a persisted scale never flashes the default.
applyFontScale(initialScale);

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

export { fontScale };

/**
 * Whether the Source panel is force-shown while a source already exists, so the
 * user can replace it. The panel is shown automatically when there is no source
 * or while recording (see `App.tsx`), so this is only the "reveal it anyway"
 * override — transient, not persisted.
 */
export const [sourcePanelPinned, setSourcePanelPinned] = createSignal(false);

/**
 * The **Annotations panel** (M14) — a right rail, the mirror of the Sidebar. It is UI
 * chrome (not project content), so its open/closed state and width are persisted
 * app-level in `localStorage`, exactly like the font scale; the annotations themselves
 * are project data (`state/annotations/`). See `docs/annotations.md` → The Annotations panel.
 */

/** Default rail width, in px. */
export const ANNOTATIONS_DEFAULT_WIDTH = 280;
/** Narrowest rail width, in px (mirrors the Sidebar's clamp). */
export const ANNOTATIONS_MIN_WIDTH = 160;
/** Widest rail width, in px. */
export const ANNOTATIONS_MAX_WIDTH = 520;

const ANNOTATIONS_STORAGE_KEY = "hey-listen:annotations-panel";

interface AnnotationsPanelPrefs {
  open: boolean;
  width: number;
}

/** Clamp a rail width to `[MIN, MAX]`. */
export function clampAnnotationsWidth(width: number): number {
  const value = Number.isFinite(width) ? width : ANNOTATIONS_DEFAULT_WIDTH;
  return Math.round(Math.min(ANNOTATIONS_MAX_WIDTH, Math.max(ANNOTATIONS_MIN_WIDTH, value)));
}

function loadAnnotationsPanel(): AnnotationsPanelPrefs {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_STORAGE_KEY);
    if (raw == null) return { open: false, width: ANNOTATIONS_DEFAULT_WIDTH };
    const parsed = JSON.parse(raw) as Partial<AnnotationsPanelPrefs>;
    return {
      open: parsed.open === true,
      width: clampAnnotationsWidth(parsed.width ?? ANNOTATIONS_DEFAULT_WIDTH),
    };
  } catch {
    return { open: false, width: ANNOTATIONS_DEFAULT_WIDTH };
  }
}

const initialAnnotationsPanel = loadAnnotationsPanel();

/** Whether the Annotations rail is shown (hidden by default). */
export const [annotationsPanelOpen, setAnnotationsPanelOpenSignal] = createSignal(
  initialAnnotationsPanel.open,
);
/** The Annotations rail's width, in px (clamped like the Sidebar). */
export const [annotationsPanelWidth, setAnnotationsPanelWidthSignal] = createSignal(
  initialAnnotationsPanel.width,
);

function persistAnnotationsPanel() {
  try {
    const prefs: AnnotationsPanelPrefs = {
      open: annotationsPanelOpen(),
      width: annotationsPanelWidth(),
    };
    localStorage.setItem(ANNOTATIONS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not persisting is fine; the panel still works for this session.
  }
}

/** Show/hide the Annotations rail, persisting the choice. */
export function setAnnotationsPanelOpen(open: boolean) {
  setAnnotationsPanelOpenSignal(open);
  persistAnnotationsPanel();
}

/** Toggle the Annotations rail. */
export function toggleAnnotationsPanel() {
  setAnnotationsPanelOpen(!annotationsPanelOpen());
}

/** Set the Annotations rail width (clamped), persisting the choice. */
export function setAnnotationsPanelWidth(width: number) {
  setAnnotationsPanelWidthSignal(clampAnnotationsWidth(width));
  persistAnnotationsPanel();
}
