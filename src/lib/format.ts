/**
 * Small, dependency-free formatting helpers shared across the app chrome (Toolbar,
 * Source panel, …). Keeping the math in one place avoids the meter helpers drifting
 * apart between the input and output meters.
 */

/**
 * Map a linear amplitude to a −60..0 dBFS meter percentage, for a meter fill.
 * Silence (≤ 0) floors at 0; full scale (1.0) maps to 100.
 */
export function meterPercent(linear: number): number {
  if (linear <= 0) return 0;
  const db = 20 * Math.log10(linear);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

/** Map a linear amplitude to a rounded dBFS readout, or "—" for silence. */
export function meterDbLabel(linear: number): string {
  return linear > 0 ? `${(20 * Math.log10(linear)).toFixed(0)} dB` : "—";
}

/**
 * Whole-second `m:ss` clock (clamped at zero), e.g. `1:05` — used for capture
 * timings and readouts. The Timeline's own times are deliberately *not* folded in
 * here: they show centiseconds (`m:ss.ss`) and span-dependent ruler ticks, so
 * their output differs and they stay local to `Timeline.tsx`.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}
