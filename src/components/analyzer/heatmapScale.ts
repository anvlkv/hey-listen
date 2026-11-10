import type { ColorStop } from "../../lib/themeFile";
import type { MatrixColorSemantics, MatrixResult } from "../../state/analyzer/types";
import { clamp01, rampStops, sampleRamp, type RampKind } from "./colormap";

/**
 * The one colour scale a heatmap and its colourbar share (M36).
 *
 * A result already carries its own domain (`minValue`/`maxValue`), unit (`"dB"`,
 * `"sone/Cam"`, …) and whether it is normalized; the tool's `MatrixView` declares the
 * rest (a symmetric domain, a transform, an axis model). Resolving all of that **once**
 * here means the pixels (`buildHeatmapImage`) and the colourbar (`HeatmapColorScale`)
 * cannot disagree about the domain, the transform, the ramp or the unit.
 *
 * The ramp itself stays [`colormap.ts`](./colormap.ts): this module only maps a value
 * onto `0…1` and picks which of the theme's two ramps to sample.
 */

export type HeatmapTransform = "linear" | "log1p";

/** The raw inputs a scale is resolved from — a matrix result, or a declared domain. */
export interface HeatmapDomain {
  min: number;
  max: number;
  transform?: HeatmapTransform;
  unit?: string | null;
  normalized?: boolean;
  /** Use the theme's **signed** ramp, with the domain's zero at the middle. */
  diverging?: boolean;
}

export interface HeatmapScale {
  /** The domain's low end, in the result's unit. */
  min: number;
  /** The domain's high end, in the result's unit. */
  max: number;
  transform: HeatmapTransform;
  /** Which theme ramp the pixels and the bar use. */
  rampKind: RampKind;
  /** The result's unit (`null` for a unitless coefficient matrix). */
  unit: string | null;
  /** True when the result declares a normalized / comparison-only scale. */
  normalized: boolean;
  /** A value's position on the ramp (0…1) — exactly the pixels' mapping. */
  position: (value: number) => number;
  /** The inverse of [`position`]: the value at ramp position `t` (for a mid tick). */
  at: (t: number) => number;
  /** A value labelled in the result's unit (the colourbar ticks). */
  formatter: (value: number) => string;
  /** The active theme's ramp stops (positions 0…1), which the bar paints. */
  stops: ColorStop[];
  /** The ramp the image is built with, sampled from exactly [`stops`]. */
  ramp: (t: number) => [number, number, number];
}

/** A non-degenerate `[lo, hi]` domain: a flat result still gets a legible ramp. */
function resolveDomain(lo: number, hi: number): [number, number] {
  const low = Number.isFinite(lo) ? lo : 0;
  let high = Number.isFinite(hi) ? hi : low + 1;
  if (!(high > low)) {
    // A near-zero or inverted range used to render as a blank image. Expand it by a
    // small relative amount (or by 1 for an all-zero domain) so the map stays visible.
    const pad = Math.abs(low) > 1e-9 ? Math.abs(low) * 0.05 : 1;
    high = low + pad;
  }
  return [low, high];
}

/** Format a value in the result's own unit, without guessing a tool. */
function unitFormatter(unit: string | null, normalized: boolean): (value: number) => string {
  if (normalized || unit == null) return (value) => value.toFixed(2);
  const lower = unit.toLowerCase();
  if (lower.includes("sone")) return (value) => `${value.toFixed(3)} ${unit}`;
  if (lower === "db" || lower === "dbfs") return (value) => `${value.toFixed(1)} ${unit}`;
  return (value) => `${value.toPrecision(3)} ${unit}`;
}

/**
 * Resolve one [`HeatmapScale`] from a declared domain. Every consumer — a matrix
 * result, the spectrogram's display floor, a compare view — funnels through here, so
 * there is exactly one mapping.
 */
export function resolveHeatmapScale(domain: HeatmapDomain): HeatmapScale {
  const [min, max] = resolveDomain(domain.min, domain.max);
  // `log1p` maps `value − min` through `ln(1 + x)`, which is only defined above `min`;
  // a diverging map is inherently signed, so it stays linear.
  const transform: HeatmapTransform = domain.diverging ? "linear" : (domain.transform ?? "linear");
  const rampKind: RampKind = domain.diverging ? "diverging" : "sequential";
  const span = max - min;
  const logSpan = Math.log1p(span);

  const position = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    if (transform === "log1p") return clamp01(Math.log1p(Math.max(value - min, 0)) / logSpan);
    return clamp01((value - min) / span);
  };

  const at = (t: number): number => {
    const clamped = clamp01(t);
    return transform === "log1p" ? min + Math.expm1(clamped * logSpan) : min + clamped * span;
  };

  const unit = domain.unit ?? null;
  const normalized = domain.normalized === true;
  const stops = rampStops(rampKind);
  return {
    min,
    max,
    transform,
    rampKind,
    unit,
    normalized,
    position,
    at,
    formatter: unitFormatter(unit, normalized),
    stops,
    ramp: (t) => sampleRamp(stops, t),
  };
}

/**
 * Resolve a matrix heatmap's scale from its own domain plus the descriptor's colour
 * semantics (`colorDomain` / `colorTransform`).
 */
export function heatmapScale(result: MatrixResult, semantics?: MatrixColorSemantics): HeatmapScale {
  const declared = semantics?.colorDomain ?? "result";
  const unit = result.unit ?? null;
  const normalized = result.normalized === true;
  if (declared === "symmetric") {
    // Signed coefficients: centre the ramp on zero so the sign reads as the colour's
    // direction, not as an arbitrary low/high split.
    const extent = Math.max(Math.abs(result.minValue), Math.abs(result.maxValue));
    const limit = Number.isFinite(extent) && extent > 0 ? extent : 1;
    return resolveHeatmapScale({ min: -limit, max: limit, unit, normalized, diverging: true });
  }
  const fixed = typeof declared === "object" ? declared : null;
  return resolveHeatmapScale({
    min: fixed?.min ?? result.minValue,
    max: fixed?.max ?? result.maxValue,
    transform: semantics?.colorTransform,
    unit,
    normalized,
  });
}
