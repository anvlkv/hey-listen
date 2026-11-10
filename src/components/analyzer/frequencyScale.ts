import type uPlot from "uplot";
import type { AxisTransform } from "../../state/chartSync";
import { formatFrequency } from "./axisFormat";

/**
 * The frequency-axis scales the `spectrum` / `spectrogram` views offer (M36):
 * physical linear / log Hz and the two auditory rates, Bark and ERB-rate.
 *
 * The mode is a **view-only** choice — it never changes what the engine computes — and
 * it is persisted as the numeric value of a `ToolParamField` select (`target: "view"`),
 * parsed into this union once, here. Everything downstream takes the union.
 *
 * **Two coordinates, deliberately.** A chart that feeds uPlot can hand it raw Hz on a
 * `distr: 3` log scale, whose ticks and cursor are already in Hz, so only the auditory
 * rates need their data transformed. A plain-canvas chart (the spectrogram) maps rows to
 * pixels itself and needs a **linear** coordinate for *every* mode. Hence:
 *
 * - [`hzToAxis`] / [`axisToHz`] — the value uPlot plots (raw Hz for `logHz`);
 * - [`hzToDisplay`] / [`displayToHz`] — a strictly monotonic coordinate a linear pixel
 *   mapping can use (`log10` Hz for `logHz`);
 * - [`frequencyAxisTransform`] — the [`AxisTransform`] the cross-chart cursor/zoom sync
 *   uses, so charts in different modes still meet on physical Hz.
 *
 * Conversions use Zwicker's Bark rate (`13·atan(0.00076 f) + 3.5·atan((f/7500)²)`) and
 * the Glasberg–Moore ERB rate (`21.4·log10(0.00437 f + 1)`). See
 * `docs/analysis-tools.md`.
 */

export type FrequencyScale = "linearHz" | "logHz" | "bark" | "erb";

/** The select's options, in persisted-value order. */
const SCALES: { scale: FrequencyScale; label: string }[] = [
  { scale: "linearHz", label: "Linear Hz" },
  { scale: "logHz", label: "Log Hz" },
  { scale: "bark", label: "Bark" },
  { scale: "erb", label: "ERB rate" },
];

/** Options for the `frequencyScale` view param (a numeric select). */
export const FREQUENCY_SCALE_OPTIONS = SCALES.map((entry, value) => ({
  value,
  label: entry.label,
}));

/** The default: log Hz reads the widest range with even octave spacing. */
export const DEFAULT_FREQUENCY_SCALE: FrequencyScale = "logHz";

/** The stored select value → the typed scale (the default for an unknown value). */
export function frequencyScaleOf(value: number | undefined): FrequencyScale {
  return SCALES[value ?? 1]?.scale ?? DEFAULT_FREQUENCY_SCALE;
}

/** The lowest frequency the log coordinate represents (keeps `log10` finite at 0 Hz). */
const LOG_FLOOR_HZ = 1e-3;

/** Zwicker's Bark rate — roughly 0.13 Bark per semitone below 500 Hz. */
export function hzToBark(hz: number): number {
  const f = Math.max(hz, 0);
  return 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) ** 2);
}

/** Inverse Bark rate, by bisection — the formula has no closed-form inverse. */
export function barkToHz(bark: number): number {
  if (!(bark > 0)) return 0;
  // Doubling finds a bracketing upper bound; the rate saturates near 25.9 Bark, so a
  // request above that simply returns the bound.
  let hi = 1000;
  while (hi < 1e6 && hzToBark(hi) < bark) hi *= 2;
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (hzToBark(mid) < bark) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Glasberg–Moore ERB rate (ERB number), 0 at 0 Hz. */
export function hzToErb(hz: number): number {
  return 21.4 * Math.log10(0.00437 * Math.max(hz, 0) + 1);
}

/** Inverse ERB rate (closed form). */
export function erbToHz(erb: number): number {
  return (10 ** (erb / 21.4) - 1) / 0.00437;
}

/** Hz → a strictly monotonic coordinate a **linear** axis or pixel mapping can use. */
export function hzToDisplay(scale: FrequencyScale, hz: number): number {
  switch (scale) {
    case "logHz":
      return Math.log10(Math.max(hz, LOG_FLOOR_HZ));
    case "bark":
      return hzToBark(hz);
    case "erb":
      return hzToErb(hz);
    default:
      return hz;
  }
}

/** The inverse of [`hzToDisplay`]. */
export function displayToHz(scale: FrequencyScale, coord: number): number {
  switch (scale) {
    case "logHz":
      return 10 ** coord;
    case "bark":
      return barkToHz(coord);
    case "erb":
      return erbToHz(coord);
    default:
      return coord;
  }
}

/**
 * Hz → the value uPlot plots. Raw Hz for `logHz`, whose scale carries `distr: 3`;
 * the transformed rate otherwise.
 */
export function hzToAxis(scale: FrequencyScale, hz: number): number {
  return scale === "logHz" ? hz : hzToDisplay(scale, hz);
}

/** The inverse of [`hzToAxis`] — what a cursor position or a range means in Hz. */
export function axisToHz(scale: FrequencyScale, x: number): number {
  return scale === "logHz" ? x : displayToHz(scale, x);
}

/**
 * The sync transform for a frequency chart: publish/consume the shared `"freq"` group
 * in **physical Hz**, whatever mode each chart is drawing. `scale` is read at call time,
 * so a chart that switches mode keeps syncing correctly without being rebuilt.
 */
export function frequencyAxisTransform(scale: () => FrequencyScale): AxisTransform {
  return {
    toBus: (x) => axisToHz(scale(), x),
    fromBus: (hz) => hzToAxis(scale(), hz),
  };
}

/** A frequency column in the chart's axis coordinate (raw Hz on the log axis). */
export function frequencyColumn(freqs: readonly number[], scale: FrequencyScale): number[] {
  return scale === "logHz" ? freqs.slice() : freqs.map((hz) => hzToAxis(scale, hz));
}

/** The axis title: the unit the tick labels are in. */
export function frequencyScaleLabel(scale: FrequencyScale): string {
  switch (scale) {
    case "bark":
      return "Bark rate (z)";
    case "erb":
      return "ERB rate";
    default:
      return "frequency (Hz)";
  }
}

/** One tick label, in the axis's own unit (the axis title names the unit). */
export function frequencyScaleTick(scale: FrequencyScale, value: number): string {
  switch (scale) {
    case "bark":
    case "erb":
      // The rate is a small number: one decimal is finer than the axis needs.
      return String(Math.round(value * 10) / 10);
    default:
      return formatFrequency(value);
  }
}

/** uPlot `values` formatter for a frequency axis in `scale`. */
export function frequencyScaleAxisValues(
  scale: FrequencyScale,
): (_self: unknown, ticks: (number | null)[]) => string[] {
  return (_self, ticks) =>
    ticks.map((tick) => (tick == null ? "" : frequencyScaleTick(scale, tick)));
}

/** Keep a log x-axis strictly positive (band-limited data may start at 0 Hz). */
export function logHzRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 1;
  const hi = max > lo ? max : lo * 2;
  return [lo, hi];
}

/**
 * The uPlot x-scale for a frequency axis. Only the logarithmic mode needs a
 * distribution — Bark and ERB are plain linear values of a transformed column.
 */
export function frequencyScaleXScale(scale: FrequencyScale): uPlot.Scale {
  return scale === "logHz"
    ? { time: false, distr: 3, log: 10, range: logHzRange }
    : { time: false };
}
