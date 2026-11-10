/**
 * A y-scale range function that never collapses to zero height. A constant series
 * (flat line, e.g. a steady zero-crossing rate or a constant entropy) would give
 * uPlot a degenerate `[v, v]` range and the line would not be visible; padding
 * keeps it on screen.
 */
export function paddedYRange(_u: unknown, min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min < 1e-9) {
    const pad = Math.max(Math.abs(max) * 0.1, 0.5);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

/**
 * A log-scale y-range with a little headroom, clamped so it never reaches 0 (a
 * frequency track on a log axis). Shared by the pitch and note-pitch lanes.
 */
export function logYRange(_u: unknown, min: number, max: number): [number, number] {
  const lo = min > 0 ? min : 0.1;
  const hi = max > lo ? max : lo * 10;
  return [lo / 1.15, hi * 1.15];
}
