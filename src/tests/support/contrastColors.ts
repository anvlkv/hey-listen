/**
 * Colour maths shared by the browser-free contrast suites (`themeContrast` /
 * `chartContrast`): parsing the palettes' CSS colours, WCAG luminance, the contrast
 * ratio, and compositing a translucent overlay onto an opaque background.
 *
 * It lives in `src/tests/support/` because only the unit suites compare palette
 * colours numerically — the app itself never needs to.
 */

export type Rgb = [number, number, number];

/** A CSS colour the palettes use: `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)`. */
export function parseRgb(value: string): { rgb: Rgb; alpha: number } {
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const body = hex[1];
    if (body.length === 3) {
      return { rgb: [0, 1, 2].map((i) => parseInt(body[i] + body[i], 16)) as Rgb, alpha: 1 };
    }
    return { rgb: [0, 2, 4].map((i) => parseInt(body.slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  }
  const fn = text.match(/^rgba?\(([^)]+)\)$/i);
  if (!fn) throw new Error(`not a parseable colour: ${value}`);
  const parts = fn[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
    throw new Error(`not a parseable colour: ${value}`);
  }
  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 };
}

/** Composite a possibly translucent colour onto an opaque background. */
export function composite(foreground: string, background: Rgb): Rgb {
  const { rgb, alpha } = parseRgb(foreground);
  return rgb.map((channel, i) => Math.round(channel * alpha + background[i] * (1 - alpha))) as Rgb;
}

/** WCAG relative luminance (sRGB channel → linear). */
export function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colours (1–21). */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
