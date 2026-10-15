/**
 * The `ThemeFile` model (M11) — a theme is **data**, a versioned JSON payload with
 * the `.heyltheme` extension. It **overlays a declared base** (`dark` / `light`)
 * rather than restating the whole palette: everything it omits falls back to that
 * built-in (see `docs/theming.md`, ADR-15).
 *
 * This module owns the shape and the parse/validate/normalise step only; the
 * registry, slot resolution and apply pipeline live in `state/themes.ts`. Parsing
 * is lenient on purpose — unknown keys are kept (forward-compatible) and only the
 * structural invariants (`kind`, `formatVersion`, `meta`) are enforced, so a theme
 * written for a newer build still loads and simply ignores what it cannot use.
 */

/**
 * The chart palette a theme overlays — the single shape the uPlot and canvas charts
 * read. A theme's `chart` field is a **partial** version of this; the base for the
 * theme's `base` supplies the rest. Field names group the UI they drive, not the tool
 * that uses them.
 */
export interface ChartTheme {
  /** Axis/tick label text colour. */
  axis: string;
  /** Grid line colour. */
  grid: string;
  /** Tick mark colour. */
  ticks: string;
  /** Axis font (unchanged across themes). */
  font: string;
  /** Default line-series stroke. */
  series: string;
  /** Spectrum "min" layer stroke. */
  seriesMin: string;
  /** Spectrum "max" layer stroke. */
  seriesMax: string;
  /** Spectrum "mean" layer stroke. */
  seriesMean: string;
  /** Waveform envelope band fill / area fill for series. */
  waveFill: string;
  /** Horizontal reference line on a chart (targets such as −14 LUFS, or 0 dBFS). */
  reference: string;
  /** Spectrogram spectral-centroid contour overlay. */
  overlayCentroid: string;
  /** Spectrogram spectral-rolloff contour overlay. */
  overlayRolloff: string;
  /** Canvas background behind a spectrogram/heatmap. */
  spectroBackground: string;
  /** Hover crosshair colour (canvas charts). */
  hover: string;
  /** Mirrored (synced) cursor colour (canvas charts). */
  mirror: string;
  /** Timeline/spectrogram full-canvas background. */
  background: string;
  /** Timeline waveform-area background. */
  surface: string;
  /** Timeline ruler background. */
  ruler: string;
  /** Timeline ruler tick colour. */
  rulerTick: string;
  /** Timeline playhead line colour. */
  playhead: string;
  /** Timeline mid-line colour. */
  midline: string;
  /** Note annotation marker colour (Timeline pins + chart note markers). */
  note: string;
  /** Timeline filtered-overlay stroke. */
  filtered: string;
  /** Timeline window move-handle fill (semi-transparent accent). */
  handleFill: string;
}

/** The `kind` discriminator every theme file carries. */
export const THEME_KIND = "hey-listen.theme";
/** The payload version this build writes. */
export const THEME_FORMAT_VERSION = 1;
/** The file extension (without the dot) for theme files. */
export const THEME_EXTENSION = "heyltheme";

/** Which built-in palette a theme overlays. */
export type ThemeBase = "dark" | "light";

/** One heatmap ramp stop: `[position 0..1, [r, g, b]]`. */
export type ColorStop = [number, number[]];

/** The identity of a theme (also the picker / persistence key). */
export interface ThemeMeta {
  /** Stable key used for the slots and persistence (e.g. `retrowave-neon`). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Optional one-line description shown in the picker. */
  description?: string;
  /** The built-in palette this theme overlays. */
  base: ThemeBase;
}

/** A serialisable theme: a base plus any subset of the four palette overlays. */
export interface ThemeFile {
  kind: string;
  formatVersion: number;
  meta: ThemeMeta;
  /** Partial overlay of the `App.css` custom properties (keys may omit `--`). */
  ui?: Record<string, string>;
  /** Partial `ChartTheme` overlay (uPlot + canvas charts). */
  chart?: Partial<ChartTheme>;
  /** Optional heatmap ramp replacing the base ramp. */
  colormap?: { stops: ColorStop[] };
  /** Optional `solid-flow` (`--xy-*`) overrides. */
  flow?: Record<string, string>;
}

/** The compact identity an agent / picker lists without the palette. */
export interface ThemeSummary extends ThemeMeta {
  /** True for a built-in theme (undeletable, always present). */
  builtin: boolean;
}

export type ThemeParseResult = { ok: true; theme: ThemeFile } | { ok: false; error: string };

/** `--`-prefix a CSS custom-property name (idempotent). */
export function cssVarName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("--") ? trimmed : `--${trimmed}`;
}

/** Coerce a JSON value to a CSS value string, or `null` when it is not usable. */
function cssValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Normalise a `ui` / `flow` overlay: `--`-prefixed keys with string values. */
function normaliseVars(raw: unknown): Record<string, string> | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = cssVarName(key);
    const text = cssValue(value);
    if (name.length > 2 && text != null) out[name] = text;
  }
  return out;
}

/** Validate a heatmap ramp: ordered `[position, [r,g,b]]` stops. */
function normaliseColormap(raw: unknown): { stops: ColorStop[] } | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const stops = (raw as { stops?: unknown }).stops;
  if (!Array.isArray(stops) || stops.length === 0) return undefined;
  const out: ColorStop[] = [];
  for (const stop of stops) {
    if (!Array.isArray(stop) || stop.length < 2) continue;
    const [pos, color] = stop as [unknown, unknown];
    const position = typeof pos === "number" && Number.isFinite(pos) ? pos : null;
    if (position == null) continue;
    if (!Array.isArray(color) || color.length < 3) continue;
    const rgb = color
      .slice(0, 3)
      .map((channel) => (typeof channel === "number" && Number.isFinite(channel) ? channel : null));
    if (rgb.some((channel) => channel == null)) continue;
    out.push([position, rgb as number[]]);
  }
  if (out.length === 0) return undefined;
  out.sort((a, b) => a[0] - b[0]);
  return { stops: out };
}

/** Fields of a `ThemeFile` that are unknown to this build are preserved verbatim. */
function keepUnknown(source: Record<string, unknown>, known: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!known.includes(key)) out[key] = value;
  }
  return out;
}

/**
 * Parse and validate a theme file's text. Returns the normalised theme on success,
 * or an inline error (spanning the current theme is left applied) on failure.
 */
export function parseThemeFile(text: string): ThemeParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${(err as Error).message}` };
  }
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "expected a JSON object" };
  }
  const source = raw as Record<string, unknown>;

  if (source.kind !== THEME_KIND) {
    return { ok: false, error: `not a Hey Listen theme (kind: ${String(source.kind)})` };
  }
  const version = source.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "missing or invalid formatVersion" };
  }

  const meta = source.meta;
  if (meta == null || typeof meta !== "object" || Array.isArray(meta)) {
    return { ok: false, error: "missing meta" };
  }
  const { id, name, description, base } = meta as Record<string, unknown>;
  if (typeof id !== "string" || id.trim() === "") {
    return { ok: false, error: "meta.id must be a non-empty string" };
  }
  if (base !== "dark" && base !== "light") {
    return { ok: false, error: 'meta.base must be "dark" or "light"' };
  }

  const theme: ThemeFile = {
    kind: THEME_KIND,
    formatVersion: version,
    meta: {
      id: id.trim(),
      name: typeof name === "string" && name.trim() !== "" ? name.trim() : id.trim(),
      ...(typeof description === "string" && description.trim() !== ""
        ? { description: description.trim() }
        : {}),
      base,
    },
    ...keepUnknown(source, ["kind", "formatVersion", "meta", "ui", "chart", "colormap", "flow"]),
  };

  const ui = normaliseVars(source.ui);
  if (ui) theme.ui = ui;
  const flow = normaliseVars(source.flow);
  if (flow) theme.flow = flow;
  const colormap = normaliseColormap(source.colormap);
  if (colormap) theme.colormap = colormap;
  if (source.chart != null && typeof source.chart === "object" && !Array.isArray(source.chart)) {
    theme.chart = source.chart as Partial<ChartTheme>;
  }

  return { ok: true, theme };
}

/** Serialise a theme to the on-disk (pretty, diffable) JSON form. */
export function serializeThemeFile(theme: ThemeFile): string {
  return `${JSON.stringify(theme, null, 2)}\n`;
}

/** A filesystem-safe id derived from a display name (`"Retrowave Neon"` →
 *  `"retrowave-neon"`), for new/imported themes. */
export function themeIdFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "theme" : slug;
}
