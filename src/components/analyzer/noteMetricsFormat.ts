/**
 * Display formatters shared by the note-segments table and its chart tooltip, so the
 * same value never reads two ways in one tab.
 *
 * Proxies are absent on short / unvoiced notes — show a dash, never a fake zero.
 */

/** Seconds as a short, fixed-precision span. */
export const span = (value: number) => `${value.toFixed(3)} s`;

/** Durations read better in ms for the short notes this tool targets. */
export const duration = (value: number) =>
  value < 1 ? `${(value * 1000).toFixed(0)} ms` : `${value.toFixed(2)} s`;

export const level = (value: number) => `${value.toFixed(1)} dBFS`;

/** A relative level is never positive; show a clean 0 for the reference note. */
export const relative = (value: number) => `${Math.min(value, 0).toFixed(1)} dB`;

/** Voiced share, as a whole percent. */
export const percent = (value: number | null) =>
  value == null ? "—" : `${(value * 100).toFixed(0)}%`;

export const hz = (value: number | null) => (value == null ? "—" : `${Math.round(value)} Hz`);
export const cents = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)} ¢`);
export const spread = (value: number | null) => (value == null ? "—" : `${value.toFixed(2)} dB`);
export const periodicity = (value: number | null) => (value == null ? "—" : value.toFixed(2));
