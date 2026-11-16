import { resolveHeatmapScale, type HeatmapScale } from "./heatmapScale";
import type { RateContribution } from "../../bindings/RateContribution";
import type { CalibratedSeriesResult, PitchResult, SeriesResult } from "../../state/analyzer";

/**
 * The one shape every result drill-down is normalised into (M38).
 *
 * A drill-down is a **frame × row** grid aligned with a tool's scalar track: the per-band
 * decomposition of a perception metric (`Contribution`), or the detector's per-frame pitch
 * candidates (`CandidateGrid`). Both are painted the same way — a compact lane inside the
 * timeline chart, and the frame's profile in the hover card — so neither needs its own
 * axis stack, colourbar and legend below the chart.
 *
 * `values` is frame-major (`frames * rows`), `rowCentres` shares the row axis, and the
 * rows are ordered **low → high** (row 0 is the lowest band), like `MatrixResult`.
 */
export interface DrilldownGrid {
  /** Frame times in source seconds, one per column. */
  times: number[];
  /** Columns actually present (a grid may be shorter than `times`). */
  frames: number;
  /** Rows: bands, semitone bins, whatever the payload's row axis is. */
  rows: number;
  /** The row axis' centres, for an end label and the card's top rows. */
  rowCentres: number[];
  /** Frame-major `frames * rows` cells. */
  values: number[];
  /** The row axis' name, e.g. `"band (Hz)"`. */
  rowLabel: string;
  /** What one cell is, e.g. `"band modulation"`. */
  cellLabel: string;
  /** The cells' unit, when they have one. */
  unit: string | null;
  /** A fixed domain (a probability is always 0…1); absent means `0 … max`. */
  domain?: [number, number];
}

/** The band × rate grid of a single frame (roughness / fluctuation strength). */
export interface RateSnapshot {
  /** Modulation rates (Hz), one per column. */
  rates: number[];
  /** Band centres (Hz), one per row. */
  bands: number[];
  /** `bands * rates` depths, band-major. */
  values: number[];
  /** The whole grid's largest value, so the cells stay comparable across frames. */
  max: number;
}

/** A grid is usable only when every axis is complete (a stored result may be short). */
function complete(values: readonly number[] | undefined, frames: number, rows: number): boolean {
  return !!values && frames > 0 && rows > 0 && values.length >= frames * rows;
}

/**
 * The per-band contribution grid a calibrated series tool carries (sharpness, roughness,
 * fluctuation strength, tonality), or `null` for every other result.
 */
export function contributionGrid(result: SeriesResult | null): DrilldownGrid | null {
  const payload = (result as Partial<CalibratedSeriesResult> | null)?.contribution;
  if (!payload) return null;
  if (!complete(payload.values, payload.frames, payload.bins)) return null;
  return {
    times: payload.times.slice(0, payload.frames),
    frames: payload.frames,
    rows: payload.bins,
    rowCentres: payload.bands.slice(0, payload.bins),
    values: payload.values,
    rowLabel: "band (Hz)",
    cellLabel: payload.label,
    unit: payload.unit ?? null,
  };
}

/**
 * The pYIN candidate grid: one probability distribution per frame. Only `pitchPyin`
 * reports candidates, so YIN / autocorrelation and older results yield `null`.
 */
export function candidateGrid(result: SeriesResult | null): DrilldownGrid | null {
  const pitch = result as Partial<PitchResult> | null;
  const payload = pitch?.candidates;
  const times = pitch?.times;
  if (!payload || !times || payload.bins <= 0) return null;
  const frames = Math.floor(payload.values.length / payload.bins);
  if (!complete(payload.values, frames, payload.bins) || times.length < frames) return null;
  return {
    times: times.slice(0, frames),
    frames,
    rows: payload.bins,
    rowCentres: payload.freqs.slice(0, payload.bins),
    values: payload.values,
    rowLabel: "semitone (Hz)",
    cellLabel: "candidate probability",
    unit: null,
    domain: [0, 1],
  };
}

/** The grid a tool's drill-down shows, if it has one. */
export function drilldownOf(result: SeriesResult | null): DrilldownGrid | null {
  return contributionGrid(result) ?? candidateGrid(result);
}

/** The column nearest `time` (source seconds), clamped into the grid. */
export function nearestFrame(grid: DrilldownGrid, time: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < grid.frames && i < grid.times.length; i++) {
    const distance = Math.abs(grid.times[i] - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** One frame's row values, or `null` when the frame is outside the grid. */
export function frameProfile(grid: DrilldownGrid, frame: number): number[] | null {
  if (frame < 0 || frame >= grid.frames) return null;
  const start = frame * grid.rows;
  const row = grid.values.slice(start, start + grid.rows);
  return row.length === grid.rows ? row : null;
}

/**
 * Where a drill-down's ramp starts.
 *
 * A heatmap that fills a panel can afford the theme ramp's near-black low end — the map
 * *is* the surface. A drill-down is a thin register inside a flat chart instead, so its
 * empty end would disappear into the plot background (the dark ramp starts at
 * `rgb(10 16 40)`, a shade of the `#1f1f1f` panel). Sampling the ramp from a visible
 * floor keeps `0` a **low** colour rather than an invisible one.
 */
const RAMP_FLOOR = 0.15;

/**
 * The colour distribution: a square root.
 *
 * A decomposition's cells are dominated by small values — a band that carries 2 % of a
 * frame's roughness is exactly the interesting case, and a linear ramp gives it 2 % of
 * the colour range. The square root spends more of the ramp on the low end while keeping
 * the cells' order and their endpoints, and [`HeatmapScale.at`] inverts it, so the
 * bar's mid tick still names the value at the ramp's middle.
 */
const DISTRIBUTION = 0.5;

/** The one colour scale the lane, the card and the legend swatch share. */
export function drilldownScale(grid: DrilldownGrid): HeatmapScale {
  const base = grid.domain
    ? resolveHeatmapScale({ min: grid.domain[0], max: grid.domain[1], unit: grid.unit })
    : resolveHeatmapScale({ min: 0, max: gridMax(grid), unit: grid.unit });
  const span = base.max - base.min || 1;
  const clamp = (t: number) => Math.min(Math.max(t, 0), 1);
  return {
    ...base,
    position: (value) => clamp(Math.pow(clamp((value - base.min) / span), DISTRIBUTION)),
    at: (t) => base.min + Math.pow(clamp(t), 1 / DISTRIBUTION) * span,
    ramp: (t) => base.ramp(RAMP_FLOOR + (1 - RAMP_FLOOR) * clamp(t)),
  };
}

/** The largest finite cell in a grid (the auto domain's top end). */
function gridMax(grid: DrilldownGrid): number {
  let max = 0;
  for (const value of grid.values) {
    if (Number.isFinite(value) && value > max) max = value;
  }
  return max;
}

/** A row label: a frequency in Hz/kHz, or a plain index when the axis is not Hz. */
export function formatRow(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`;
  if (value >= 10) return `${Math.round(value)} Hz`;
  return `${value.toFixed(1)} Hz`;
}

/**
 * The band × rate grid at one frame, or `null` when the tool has no rate spectrum or
 * the frame sits outside the grid. The domain covers the **whole** grid, not this frame,
 * so a card's colours do not re-normalise as the cursor moves.
 */
export function rateSnapshotAt(result: SeriesResult | null, frame: number): RateSnapshot | null {
  const grid = (result as Partial<CalibratedSeriesResult> | null)?.rateContribution;
  if (!grid || !rateComplete(grid)) return null;
  if (frame < 0 || frame >= grid.frames) return null;
  const stride = grid.bands * grid.rates;
  const start = frame * stride;
  const values = grid.values.slice(start, start + stride);
  if (values.length !== stride) return null;
  let max = 0;
  for (const value of grid.values) {
    if (Number.isFinite(value) && value > max) max = value;
  }
  return {
    rates: grid.rateHz.slice(0, grid.rates),
    bands: grid.bandHz.slice(0, grid.bands),
    values,
    max,
  };
}

/** A rate grid is usable only when every axis is complete. */
export function rateComplete(grid: RateContribution): boolean {
  return (
    grid.frames > 0 &&
    grid.bands > 0 &&
    grid.rates > 0 &&
    grid.bandHz.length >= grid.bands &&
    grid.rateHz.length >= grid.rates &&
    grid.values.length >= grid.frames * grid.bands * grid.rates
  );
}

/** The `0 … max` scale a rate snapshot's cells and its own legend share. */
export function rateScale(snapshot: RateSnapshot): HeatmapScale {
  return resolveHeatmapScale({ min: 0, max: snapshot.max, unit: null });
}
