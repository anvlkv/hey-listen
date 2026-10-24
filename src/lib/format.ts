/**
 * Small, dependency-free formatting helpers shared across the app chrome (Toolbar,
 * Source panel, …). Keeping the math in one place avoids the meter helpers drifting
 * apart between the input and output meters.
 */

/** Bottom of the meters' −60..0 dBFS scale. */
export const METER_FLOOR_DB = -60;

/** Linear amplitude at [`METER_FLOOR_DB`] — levels below it read as silence. */
export const METER_FLOOR_LINEAR = 10 ** (METER_FLOOR_DB / 20);

/**
 * Linear amplitude → dBFS, floored at the bottom of the meter scale. Silence,
 * NaN and other non-finite inputs floor; levels above 0 dBFS are kept so the
 * label can report them while the fill clamps to full scale.
 */
function meterDb(linear: number): number {
  if (!(linear > 0) || !Number.isFinite(linear)) return METER_FLOOR_DB;
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(linear));
}

/**
 * Map a linear amplitude to a −60..0 dBFS meter percentage, for a meter fill.
 * Silence (≤ 0) floors at 0; full scale (1.0) maps to 100.
 */
export function meterPercent(linear: number): number {
  const percent = ((meterDb(linear) - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
  return Math.max(0, Math.min(100, percent));
}

/**
 * Map a linear amplitude to a rounded dBFS readout. Anything at or below the meter
 * floor reads as silence — without this, a peak-hold that decays multiplicatively
 * (e.g. after a stretch of silence) eventually prints absurd values like `-3000 dB`.
 */
export function meterDbLabel(linear: number): string {
  if (!(linear > 0) || !Number.isFinite(linear)) return "—";
  const db = 20 * Math.log10(linear);
  if (db < METER_FLOOR_DB) return `< ${METER_FLOOR_DB} dB`;
  // `toFixed` renders values in (-0.5, 0) as "-0"; normalise it to a plain zero.
  const rounded = Math.round(db);
  return `${rounded === 0 ? 0 : rounded} dB`;
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
