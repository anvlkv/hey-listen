/**
 * Colour maths shared by the browser-free contrast suites (`themeContrast` /
 * `chartContrast`): parsing the palettes' CSS colours, WCAG luminance, the contrast
 * ratio, and compositing a translucent overlay onto an opaque background.
 *
 * The maths itself is **color2k** (the app's one colour library); this module only keeps
 * the `Rgb`-tuple shape the suites compare numerically.
 *
 * It lives in `src/tests/support/` because only the unit suites compare palette
 * colours numerically — the app itself never needs to.
 */
import { getContrast, getLuminance, mix, parseToRgba, rgba } from "color2k";

export type Rgb = [number, number, number];

/** An opaque tuple colour as a CSS string color2k accepts. */
function css([r, g, b]: Rgb): string {
  return rgba(r, g, b, 1);
}

/** A CSS colour the palettes use (any color2k-supported form: hex, `rgb()`, `rgba()`, …). */
export function parseRgb(value: string): { rgb: Rgb; alpha: number } {
  const [r, g, b, alpha] = parseToRgba(value);
  const rgb: Rgb = [r, g, b];
  return { rgb, alpha };
}

/** Composite a possibly translucent colour onto an opaque background. */
export function composite(foreground: string, background: Rgb): Rgb {
  const [r, g, b, alpha] = parseToRgba(foreground);
  // `mix(a, b, weight)` weights its **second** colour, so the foreground is the second one.
  const [mr, mg, mb] = parseToRgba(mix(css(background), rgba(r, g, b, 1), alpha));
  return [Math.round(mr), Math.round(mg), Math.round(mb)];
}

/** WCAG relative luminance (sRGB channel → linear). */
export function luminance(rgb: Rgb): number {
  return getLuminance(css(rgb));
}

/** WCAG contrast ratio between two opaque colours (1–21). */
export function contrast(a: Rgb, b: Rgb): number {
  return getContrast(css(a), css(b));
}
