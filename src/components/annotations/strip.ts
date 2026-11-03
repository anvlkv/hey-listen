/**
 * The annotation **strip** (M14): the thin lane along the bottom edge of the Timeline and of
 * every time-axis chart where an annotation's anchor is drawn and grabbed.
 *
 * Anchoring the annotations to the bottom keeps them clear of the Timeline's own window
 * move-handle bar (which owns the top band under the ruler) and of uPlot's drag/zoom
 * area, so an annotation is both visible and easy to grab. The height lives here — one
 * constant shared by `components/timeline/` and `components/analyzer/annotationPlugins.ts`
 * — so the lane the user sees and the lane the pointer hit-tests are the same.
 * See `docs/annotations.md` → Surfacing.
 */
export const ANNOTATION_STRIP_H = 12;
