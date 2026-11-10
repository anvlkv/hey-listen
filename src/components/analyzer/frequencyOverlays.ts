import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { AnalyzerBus } from "../../state/chartSync";
import { chartTheme } from "../../state/themes";
import { formatFrequency } from "./axisFormat";
import { barkToHz, erbToHz, hzToAxis, type FrequencyScale } from "./frequencyScale";

/**
 * Overlays that make a frequency chart **explanatory** (M36): the physically meaningful
 * peaks in a spectrum, and optional octave / Bark / ERB band boundaries.
 *
 * Both are `draw`-hook plugins, so the marks live in the plot and follow zoom/pan: every
 * position goes through `u.valToPos()` on the chart's own x-scale, and every colour comes
 * from `chartTheme()`. Peak **detection** is a plain function kept outside the component
 * (and outside the plugin), so it can be tested and reused by a compare view.
 *
 * See `docs/chart-review/chart-recommendations.md` items 5 and 6.
 */

/** A local spectral maximum worth labelling. */
export interface SpectralPeak {
  /** The peak's frequency (Hz). */
  hz: number;
  /** Its level, in the result's dB unit. */
  db: number;
  /** The FFT bin it sits on. */
  bin: number;
}

/** How far above its saddles a local maximum must rise to count as a peak. */
const PROMINENCE_DB = 6;
/** Bins either side that must be no higher (a single-bin wiggle is not a peak). */
const NEIGHBOURHOOD = 2;
/** How far down each flank to look for its saddle, in bins. */
const SADDLE_SPAN = 24;
/** Minimum spacing between two kept peaks, as a fraction of the lower peak's frequency. */
const SPACING_FRACTION = 0.04;
/** Never keep more labels than this — the chart is not a peak table. */
const MAX_PEAKS = 8;

/**
 * The strongest **prominent** local maxima of a magnitude spectrum, highest first, then
 * returned in frequency order. `magDb` may carry gaps; a peak needs a finite level and
 * `PROMINENCE_DB` of rise over the saddles on both flanks, and peaks closer than a few
 * percent (or 12 Hz) collapse to the louder one.
 */
export function detectSpectralPeaks(
  freqs: readonly number[],
  magDb: readonly (number | null)[],
  limit = MAX_PEAKS,
): SpectralPeak[] {
  const count = Math.min(freqs.length, magDb.length);
  const level = (index: number): number => {
    if (index < 0 || index >= count) return -Infinity;
    const value = magDb[index];
    return typeof value === "number" && Number.isFinite(value) ? value : -Infinity;
  };

  const candidates: SpectralPeak[] = [];
  for (let bin = 0; bin < count; bin++) {
    const db = level(bin);
    if (!Number.isFinite(db)) continue;
    let isMax = true;
    for (let d = 1; d <= NEIGHBOURHOOD && isMax; d++) {
      if (level(bin - d) > db || level(bin + d) > db) isMax = false;
    }
    if (!isMax) continue;
    // Prominence: walk each flank down until a higher maximum blocks it, keeping the
    // deepest point reached. The peak rises above the *higher* of the two saddles — a
    // smooth hump's shoulder is not a saddle, the valley between two peaks is.
    const flankMin = (step: number) => {
      let deepest = db;
      for (let d = 1; d <= SADDLE_SPAN; d++) {
        const value = level(bin + step * d);
        if (value > db) break;
        if (value < deepest) deepest = value;
      }
      return deepest;
    };
    const saddle = Math.max(flankMin(-1), flankMin(1));
    if (!(db - saddle >= PROMINENCE_DB)) continue;
    candidates.push({ hz: freqs[bin], db, bin });
  }

  const kept: SpectralPeak[] = [];
  for (const peak of candidates.sort((a, b) => b.db - a.db)) {
    const tooClose = kept.some(
      (other) => Math.abs(other.hz - peak.hz) < Math.max(12, peak.hz * SPACING_FRACTION),
    );
    if (tooClose) continue;
    kept.push(peak);
    if (kept.length >= limit) break;
  }
  return kept.sort((a, b) => a.hz - b.hz);
}

/**
 * Draw the detected peaks: a dot and a short stem at each maximum, with its frequency
 * above it. A second pass drops any label whose box would collide with one already drawn
 * (peaks are tried loudest first, so the important label survives).
 */
export function spectralPeakLabels(
  peaks: () => SpectralPeak[],
  scale: () => FrequencyScale,
): UplotPluginFactory<AnalyzerBus> {
  return () => ({
    hooks: {
      draw: (u) => {
        if (!u.ctx) return;
        const found = peaks();
        if (found.length === 0) return;
        const { ctx, bbox } = u;
        const theme = chartTheme();
        ctx.save();
        ctx.beginPath();
        ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
        ctx.clip();
        ctx.font = theme.font;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const taken: { x: number; y: number; width: number }[] = [];
        // Loudest first, so the collision pass keeps the important labels.
        for (const peak of [...found].sort((a, b) => b.db - a.db)) {
          const x = u.valToPos(hzToAxis(scale(), peak.hz), "x", true);
          const y = u.valToPos(peak.db, "y", true);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (x < bbox.left || x > bbox.left + bbox.width) continue;
          if (y < bbox.top || y > bbox.top + bbox.height) continue;
          const label = formatFrequency(peak.hz);
          const width = ctx.measureText(label).width;
          const row = y - 10;
          const collides = taken.some(
            (other) =>
              Math.abs(other.x - x) < (other.width + width) / 2 + 4 && Math.abs(other.y - row) < 12,
          );
          if (collides) continue;
          taken.push({ x, y: row, width });
          ctx.strokeStyle = theme.seriesMax;
          ctx.fillStyle = theme.seriesMax;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, y);
          ctx.lineTo(Math.round(x) + 0.5, y - 5);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillText(label, x, row);
        }
        ctx.restore();
      },
    },
  });
}

/** Which band boundaries an overlay draws. */
export type BandGuide = "off" | "octave" | "bark" | "erb";

/** The select's options, in persisted-value order. */
const BAND_GUIDES: { guide: BandGuide; label: string }[] = [
  { guide: "off", label: "Off" },
  { guide: "octave", label: "Octave bands" },
  { guide: "bark", label: "Bark bands" },
  { guide: "erb", label: "ERB bands" },
];

/** Options for the `bandGuides` view param (a numeric select). */
export const BAND_GUIDE_OPTIONS = BAND_GUIDES.map((entry, value) => ({
  value,
  label: entry.label,
}));

/** The stored select value → the typed guide (`off` for an unknown value). */
export function bandGuideOf(value: number | undefined): BandGuide {
  return BAND_GUIDES[value ?? 0]?.guide ?? "off";
}

/** Nominal octave-band edges, 31.5 Hz … 16 kHz (ISO centre frequencies). */
const OCTAVE_EDGES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** The boundaries a guide marks, in Hz (empty for `off`). */
export function bandEdges(guide: BandGuide): number[] {
  switch (guide) {
    case "octave":
      return OCTAVE_EDGES;
    case "bark":
      // One line per whole Bark, up to the top of the scale (~25.9 Bark).
      return Array.from({ length: 24 }, (_, index) => barkToHz(index + 1));
    case "erb":
      // One line per whole ERB-rate step (~41 at 20 kHz).
      return Array.from({ length: 41 }, (_, index) => erbToHz(index + 1));
    default:
      return [];
  }
}

/**
 * Faint vertical rules at the guide's boundaries, placed through the chart's frequency
 * scale so Bark bands line up on a Bark axis. Boundaries that would land within 6 px of
 * the previous one are dropped rather than drawn as a smear.
 */
export function bandGuideLines(
  guide: () => BandGuide,
  scale: () => FrequencyScale,
): UplotPluginFactory<AnalyzerBus> {
  return () => ({
    hooks: {
      draw: (u) => {
        if (!u.ctx) return;
        const edges = bandEdges(guide());
        if (edges.length === 0) return;
        const { ctx, bbox } = u;
        ctx.save();
        ctx.strokeStyle = chartTheme().grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let last = -Infinity;
        for (const hz of edges) {
          const x = u.valToPos(hzToAxis(scale(), hz), "x", true);
          if (!Number.isFinite(x) || x < bbox.left || x > bbox.left + bbox.width) continue;
          if (x - last < 6) continue;
          last = x;
          const px = Math.round(x) + 0.5;
          ctx.moveTo(px, bbox.top);
          ctx.lineTo(px, bbox.top + bbox.height);
        }
        ctx.stroke();
        ctx.restore();
      },
    },
  });
}
