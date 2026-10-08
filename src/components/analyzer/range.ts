/**
 * A y-scale range function that never collapses to zero height. A constant series
 * (flat line, e.g. a steady zero-crossing rate or a constant entropy) would give
 * uPlot a degenerate `[v, v]` range and the line would not be visible; padding
 * keeps it on screen.
 */
export function paddedYRange(
  _u: unknown,
  min: number,
  max: number,
): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min < 1e-9) {
    const pad = Math.max(Math.abs(max) * 0.1, 0.5);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}
