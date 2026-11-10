import { type TooltipProps } from "@dschz/solid-uplot/plugins";
import ChartTooltip from "./ChartTooltip";

/**
 * Modulation-chart formatting shared by the analyzer view and the compare view
 * (M25.A): the silence floor, the fixed y-range, the rate-axis tick formatter and the
 * tooltip. Both charts plot the same AM/FM spectra on the same rate axis, so they must
 * agree on what a "real" level is and how a rate reads.
 */

/** Levels below this are the analysis floor (silence), not a real spectrum. */
export const SPECTRUM_FLOOR = -119.5;

/** A fixed y-range so AM and FM (and A/B) are directly comparable and silence is flat. */
export const MOD_Y_RANGE: [number, number] = [-60, 5];

/** A modulation rate, short enough for an axis tick. */
export function formatRate(hz: number): string {
  return `${hz.toFixed(Math.abs(hz) < 10 ? 1 : 0)} Hz`;
}

/**
 * The modulation-rate bands the perception model is most sensitive to (M36). These are
 * **reference regions**, not decision boundaries: the roughness and fluctuation filters
 * are tuned near 70 Hz and 4 Hz respectively, so a peak inside one is what those models
 * would respond to. `docs/analysis-tools.md` (roughness / fluctuation strength) owns the
 * model description.
 */
export const MOD_REFERENCE_REGIONS: { from: number; to: number; label: string }[] = [
  { from: 2, to: 8, label: "fluctuation (~4 Hz)" },
  { from: 40, to: 100, label: "roughness (~70 Hz)" },
];

/** What the AM and FM halves are, for the chart's legend caption. */
export const MOD_LEGEND_NOTE =
  "AM = frame-RMS envelope · FM = pitch residual (cents) · relative dB";

/** Axis tick labels from uPlot's numeric splits (it may pass null minor splits). */
export function rateAxisValues(_self: unknown, ticks: (number | null)[]): string[] {
  return ticks.map((tick) => (tick == null ? "" : formatRate(tick)));
}

/** Keep real bins; the floor means "silence", which should read as a gap. */
export function visibleLevels(db: number[]): (number | null)[] {
  return db.map((value) => (value > SPECTRUM_FLOOR ? value : null));
}

/** The modulation chart's tooltip (modulation rate × dB). */
export const ModulationTooltip = (props: TooltipProps) => (
  <ChartTooltip
    {...props}
    xLabel="rate"
    formatX={(value) => formatRate(value)}
    formatY={(value) => `${value.toFixed(1)} dB`}
  />
);
