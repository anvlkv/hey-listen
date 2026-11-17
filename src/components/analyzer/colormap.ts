import { mix, parseToRgba, rgba } from "color2k";
import type { ColorStop } from "../../lib/themeFile";
import { activeColormapStops } from "../../state/themes";

/**
 * The **one** ramp sampler shared by every heatmap pixel and every colourbar.
 *
 * A theme carries up to two ramps (M36): a **sequential** one for unsigned
 * magnitudes (energy, loudness, level) and a **diverging** one for signed values
 * (MFCC coefficients), where the middle of the ramp is the domain's zero. Both live
 * in `state/themes/basePalettes.ts`, next to the rest of the palette, and a theme may
 * replace either. Sampling is a single function so the image
 * ([`HeatmapScale.ramp`](./heatmapScale.ts)) and the bar
 * ([`HeatmapColorScale`](./HeatmapColorScale.tsx)) cannot interpolate differently.
 *
 * Interpolation is color2k's `mix` between the neighbouring stops. The per-pixel path
 * (`buildHeatmapImage`) needs a sample millions of times per rebuild, so each stops array
 * gets one **memoized 256-step table** built with `mix`; sampling is then a lookup. The
 * stops arrays come from the theme (stable references), and a theme change yields a new
 * array, so the table can never go stale.
 */

/** The ramp family a heatmap uses. */
export type RampKind = "sequential" | "diverging";

/** Steps in a cached ramp: more than an 8-bit channel resolves, so no visible banding. */
const RAMP_STEPS = 256;

/** Interpolate `t` (0…1) through ordered stops with color2k — the one ramp formula. */
function mixStops(stops: ColorStop[], at: number): [number, number, number] {
  for (let i = 1; i < stops.length; i++) {
    if (at <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = t1 > t0 ? clamp01((at - t0) / (t1 - t0)) : 0;
      const [r, g, b] = parseToRgba(
        mix(rgba(c0[0], c0[1], c0[2], 1), rgba(c1[0], c1[1], c1[2], 1), k),
      );
      return [Math.round(r), Math.round(g), Math.round(b)];
    }
  }
  const last = stops[stops.length - 1][1];
  return [last[0], last[1], last[2]];
}

/** One stops array's table of RGB triples, built lazily and shared by every caller. */
const tables = new WeakMap<ColorStop[], Uint8Array>();

function rampTable(stops: ColorStop[]): Uint8Array {
  const cached = tables.get(stops);
  if (cached) return cached;
  const table = new Uint8Array(RAMP_STEPS * 3);
  for (let i = 0; i < RAMP_STEPS; i++) {
    const [r, g, b] = mixStops(stops, i / (RAMP_STEPS - 1));
    table[i * 3] = r;
    table[i * 3 + 1] = g;
    table[i * 3 + 2] = b;
  }
  tables.set(stops, table);
  return table;
}

/** Sample a ramp at `t` (0…1) — the one ramp sampler. */
export function sampleRamp(stops: ColorStop[], t: number): [number, number, number] {
  const table = rampTable(stops);
  const i = Math.round(clamp01(t) * (RAMP_STEPS - 1));
  return [table[i * 3], table[i * 3 + 1], table[i * 3 + 2]];
}

/** A heatmap ramp's stops for the active theme (a theme's overlay, else its base). */
export function rampStops(kind: RampKind = "sequential"): ColorStop[] {
  return activeColormapStops(kind);
}

/**
 * The active theme's sequential ramp at `t` — the default for `buildHeatmapImage`.
 * Reads the active theme, so callers that evaluate it inside a memo/effect (the image
 * builders) re-render the heatmap when the theme changes.
 */
export function spectroColormap(t: number): [number, number, number] {
  return sampleRamp(rampStops("sequential"), t);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
