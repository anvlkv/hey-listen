/**
 * Shared axis sizing + tick formatting for the analyzer charts.
 *
 * The uPlot charts (`series` / `spectrum` / `waveform`) and the plain-canvas
 * heatmaps (`matrix` / `spectrogram`) label axes the same way from here, so the
 * charts stay readable when a tab is narrow: values are kept short (`kHz`/`MHz`,
 * compact times) so tick labels neither clip nor collide.
 */

/** Width (px) reserved for y-axis value labels (wider than uPlot's default 50). */
export const Y_AXIS_SIZE = 58;
/** Height (px) reserved for x-axis value labels. */
export const X_AXIS_SIZE = 52;
/** Target minimum spacing (px) between ticks on a time x-axis. */
export const TIME_AXIS_SPACE = 56;
/** Target minimum spacing (px) between ticks on a frequency x-axis. */
export const FREQ_AXIS_SPACE = 68;
/** Target minimum spacing (px) between ticks on a y-axis. */
export const Y_AXIS_SPACE = 34;

/** The slice of the uPlot instance the axis value formatters read. */
interface AxisSelf {
  scales: { [key: string]: { min?: number; max?: number } };
}

function pad2(value: number): string {
  return String(Math.floor(value)).padStart(2, "0");
}

/** Drop insignificant trailing zeros: `2.50` → `2.5`, `12.0` → `12`. */
function trimZeros(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Frequency label: whole `Hz` below 1 kHz, then `kHz` / `MHz` to keep it short. */
export function formatFrequency(hz: number): string {
  const abs = Math.abs(hz);
  if (abs >= 1e6) return `${trimZeros(hz / 1e6, 2)} MHz`;
  if (abs >= 1000) return `${trimZeros(hz / 1e3, 1)} kHz`;
  return `${Math.round(hz)} Hz`;
}

/**
 * Compact time tick label. The granularity follows the visible `span` so labels
 * stay short: `h:mm:ss` for long spans, whole-second `m:ss` from a minute up,
 * and `ss.s` / finer for short spans.
 */
export function formatTimeTick(value: number, span: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (span >= 3600 || abs >= 3600) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    return `${sign}${h}:${pad2(m)}:${pad2(abs % 60)}`;
  }
  if (span >= 60 || abs >= 60) {
    const m = Math.floor(abs / 60);
    const s = abs - m * 60;
    return span >= 60 ? `${sign}${m}:${pad2(s)}` : `${sign}${m}:${s.toFixed(1).padStart(4, "0")}`;
  }
  const decimals = span < 0.2 ? 3 : span < 2 ? 2 : 1;
  return `${sign}${abs.toFixed(decimals)}`;
}

/** Current span of the x scale (seconds for a time axis, Hz for a frequency one). */
function xSpan(self: AxisSelf): number {
  const min = self.scales.x?.min ?? 0;
  const max = self.scales.x?.max ?? 0;
  return Math.abs(max - min);
}

/** uPlot `values` formatter: compact time labels for a time x-axis. uPlot passes
 *  `null` for unlabeled minor splits — hide those labels. */
export function timeAxisValues(self: AxisSelf, ticks: (number | null)[]): string[] {
  const span = xSpan(self);
  return ticks.map((t) => (t == null ? "" : formatTimeTick(t, span)));
}

/** uPlot `values` formatter: `kHz`/`MHz` labels for a frequency x- or y-axis. */
export function frequencyAxisValues(_self: AxisSelf, ticks: (number | null)[]): string[] {
  return ticks.map((t) => (t == null ? "" : formatFrequency(t)));
}
