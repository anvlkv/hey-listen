import { BASE_COLORMAP, BASE_COLORMAP_DIVERGING } from "../src/state/themes/basePalettes";
import { BASE_CHART } from "../src/state/themes/chart";
import type { ColorStop, ThemeBase } from "../src/lib/themeFile";
import { assertEqual, check, report } from "./testHarness";
import { composite, contrast, luminance, parseRgb, type Rgb } from "./contrastColors";

/**
 * Heatmap and overlay contrast for both base themes (M36, chart review item 11).
 *
 * A heatmap's lowest rendered value must not disappear into the plot background: the
 * sequential ramp's first stop is data, not empty canvas. The same holds for the
 * diverging ramp's endpoints and its zero midpoint, and for the overlay colours drawn
 * over a heatmap (contours, markers, the hover cross).
 *
 * These assertions read the **base** palettes only — the values every theme inherits
 * when its overlay omits them — and use the stop colours literally, because the ramp's
 * endpoints are not interpolated. See `docs/theming.md`.
 */

/** Straight RGB distance — a stop need only be *seen*, not read like text. */
function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A ramp endpoint is visible when it is this far from the plot background. */
const MIN_STOP_DISTANCE = 24;
/** An overlay line must separate from the ramp behind it by at least this ratio. */
const MIN_OVERLAY_CONTRAST = 1.8;

/** The chart roles drawn *over* a heatmap (contours, markers, the cursor and rules). */
const OVERLAY_ROLES = [
  "overlayCentroid",
  "overlayRolloff",
  "hover",
  "mirror",
  "playhead",
  "reference",
  "markerOnset",
  "markerBeat",
  "markerDownbeat",
  "annotation",
] as const;

const BASES: ThemeBase[] = ["dark", "light"];

/** The visible stop colours of a ramp: its first, middle and last stop. */
function rampEndpoints(stops: ColorStop[]): { name: string; rgb: Rgb }[] {
  const at = (stop: ColorStop): Rgb => {
    const [r = 0, g = 0, b = 0] = stop[1];
    return [r, g, b];
  };
  return [
    { name: "low", rgb: at(stops[0]) },
    { name: "mid", rgb: at(stops[Math.floor(stops.length / 2)]) },
    { name: "high", rgb: at(stops[stops.length - 1]) },
  ];
}

for (const base of BASES) {
  const background = parseRgb(BASE_CHART[base].spectroBackground).rgb;

  for (const [kind, ramps] of [
    ["sequential", BASE_COLORMAP],
    ["diverging", BASE_COLORMAP_DIVERGING],
  ] as const) {
    for (const stop of rampEndpoints(ramps[base])) {
      check(`${base} ${kind} ramp ${stop.name} stop vs plot background`, () => {
        const gap = distance(stop.rgb, background);
        assertEqual(
          gap >= MIN_STOP_DISTANCE,
          true,
          `${base} ${kind} ${stop.name} stop ${JSON.stringify(stop.rgb)} is only ${gap.toFixed(1)} from ${JSON.stringify(background)}`,
        );
      });
    }

    // The sequential ramp is perceptually ordered: its lightness must not reverse.
    // (A diverging ramp is signed by design — its midpoint is the domain's zero — so it
    // is checked for endpoints and visibility only.)
    const [low, mid, high] = rampEndpoints(ramps[base]);
    check(`${base} ${kind} ramp is ordered (low ≠ high)`, () => {
      assertEqual(distance(low.rgb, high.rgb) > MIN_STOP_DISTANCE * 2, true);
    });
    if (kind === "sequential") {
      check(`${base} ${kind} ramp midpoint sits between its ends`, () => {
        const between =
          (luminance(mid.rgb) - luminance(low.rgb)) * (luminance(high.rgb) - luminance(mid.rgb)) >=
          0;
        assertEqual(between, true, `${base} ${kind} ramp lightness is not monotonic`);
      });
    }
  }

  for (const role of OVERLAY_ROLES) {
    check(`${base} overlay ${role} vs plot background`, () => {
      const ratio = contrast(composite(BASE_CHART[base][role], background), background);
      assertEqual(
        ratio >= MIN_OVERLAY_CONTRAST,
        true,
        `${base} ${role} is ${ratio.toFixed(2)}:1 over the heatmap background`,
      );
    });
  }
}

report("chartContrast");
