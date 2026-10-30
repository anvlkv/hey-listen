/**
 * The waveform compare view's geometry (M25.A).
 *
 * A waveform result stores an envelope of `max`/`min` buckets spread evenly over its
 * analysis window. Two results may only be overlaid **bucket for bucket** when those
 * windows are identical — bucket *i* must cover the same absolute-time span on both
 * sides — otherwise the delta is meaningless and the view draws them separately.
 * See `docs/comparison.md` → "The delta".
 */

/** A `start..end` span in source seconds. */
export interface SpanLike {
  start: number;
  end: number;
}

/** Whether two waveform windows are identical (same span, same bucket count). */
export function identicalWindows(
  a: SpanLike,
  b: SpanLike,
  aBuckets: number,
  bBuckets: number,
): boolean {
  return (
    aBuckets > 0 &&
    aBuckets === bBuckets &&
    Math.abs(a.start - b.start) < 1e-6 &&
    Math.abs(a.end - b.end) < 1e-6
  );
}

/** The source-second time of every envelope bucket (bucket 0 starts the window). */
export function bucketTimes(windowStart: number, duration: number, buckets: number): number[] {
  if (buckets <= 0) return [];
  const step = duration / buckets;
  return Array.from({ length: buckets }, (_, index) => windowStart + index * step);
}
