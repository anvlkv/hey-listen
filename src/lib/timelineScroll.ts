/**
 * Geometry for the Timeline's horizontal scrollbar: the whole-source track that shows
 * where the visible view sits and pans it when dragged (see
 * `components/timeline/ScrollBar.tsx`).
 *
 * Pure, so the parts that are easy to get subtly wrong — clamping a pan to the source,
 * and placing the thumb — are unit-tested in `scripts/timelineScroll.test.ts`.
 */

/** Clamp a view start so the whole visible span stays inside the source. */
export function clampViewStart(start: number, duration: number, span: number): number {
  const furthest = Math.max(0, duration - span);
  return Math.max(0, Math.min(start, furthest));
}

/** The thumb's `left` / `width` as CSS percentages of the track. */
export function thumbPercent(
  viewStart: number,
  viewEnd: number,
  duration: number,
): { left: string; width: string } {
  if (!(duration > 0)) return { left: "0%", width: "100%" };
  const span = Math.max(viewEnd - viewStart, 0);
  const width = Math.min(100, (span / duration) * 100);
  const left = Math.max(0, Math.min((viewStart / duration) * 100, 100 - width));
  return { left: `${left}%`, width: `${width}%` };
}
