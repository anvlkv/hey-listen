import centroidJson from "../../story-assets/Grieg_Holberg_Suite_1_Praeludium.spectralCentroid.json";
import downbeatsJson from "../../story-assets/Grieg_Holberg_Suite_1_Praeludium.downbeats.json";

/**
 * The film's audio-reactive layer.
 *
 * The exported analyses cover the same 52.0–83.2 s window the film plays, so every
 * frame maps 1:1 onto a measured musical event. Two of them describe *dynamics* — the
 * spectral centroid (dark → bright) and the beat grid with its onset strength — and
 * that is what the camera and overlays follow. Pitch-class (chromagram) colouring is
 * deliberately not read here: the loop's motion comes from energy and brightness, not
 * harmony.
 *
 * Times are film seconds (source − 52.0 s). Signals are smoothed once at load so the
 * per-frame lookups are cheap and the motion reads as a continuous swell rather than
 * 86 Hz of sample jitter.
 */

const LOOP_START = 52.0;

type CentroidResult = {
  times: number[];
  values: number[];
  minValue: number;
  maxValue: number;
};

type DownbeatsResult = {
  beatTimes: number[];
  downbeatTimes: number[];
  onsetStrength: number[];
  times: number[];
  bpm: number;
};

const centroid = (centroidJson as {result: CentroidResult}).result;
const grid = (downbeatsJson as {result: DownbeatsResult}).result;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rightmost index whose time is `<= t` (the arrays are sorted). */
const lowerBound = (times: number[], t: number): number => {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Linearly interpolate `values` at source time `t`. */
const sample = (times: number[], values: number[], t: number): number => {
  const n = times.length;
  if (n === 0) return 0;
  if (t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];
  const i = lowerBound(times, t);
  const a = times[i - 1];
  const b = times[i];
  const k = (t - a) / (b - a);
  return values[i - 1] + (values[i] - values[i - 1]) * k;
};

/** Centred moving average — cheap at this length, no trailing lag. */
const smooth = (values: number[], radius: number): number[] => {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
};

// ~0.25 s of context either side at the 512-sample hop (11.6 ms).
const SMOOTH_RADIUS = 10;

const centroidSmooth = smooth(centroid.values, SMOOTH_RADIUS);
const onsetSmooth = smooth(grid.onsetStrength, SMOOTH_RADIUS);

// The smoothed peak (not the raw spike) is the right ceiling: onset is heavily
// skewed toward near-silence, so dividing by the single loudest sample would
// leave the whole loop sitting at ~0.2 and kill the breath.
const onsetMax = Math.max(...onsetSmooth);

const downbeats = grid.downbeatTimes.map((t) => t - LOOP_START);

const source = (filmSec: number) => LOOP_START + filmSec;

/** 0..1 brightness of the spectral centroid, log-scaled and smoothed. */
export const brightness = (filmSec: number): number => {
  const v = sample(centroid.times, centroidSmooth, source(filmSec));
  const lo = Math.log(centroid.minValue);
  const hi = Math.log(centroid.maxValue);
  return clamp01((Math.log(v) - lo) / (hi - lo));
};

/** 0..1 onset strength, smoothed — the loop's "density" signal. */
export const intensity = (filmSec: number): number => {
  const v = sample(grid.times, onsetSmooth, source(filmSec));
  return clamp01(v / onsetMax);
};

/** Smooth 1 → 0 pulse following the most recent downbeat. */
export const downbeatPulse = (filmSec: number, decay = 0.5): number => {
  let recent = Number.NEGATIVE_INFINITY;
  for (const db of downbeats) {
    if (db <= filmSec) recent = db;
    else break;
  }
  if (recent === Number.NEGATIVE_INFINITY) return 0;
  const dt = filmSec - recent;
  if (dt < 0 || dt > decay) return 0;
  return 0.5 + 0.5 * Math.cos((Math.PI * dt) / decay);
};
