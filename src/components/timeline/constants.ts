/**
 * Layout and interaction constants for the Timeline canvas (all in CSS pixels
 * unless noted). Kept together so the drawing helpers (`draw.ts`) and the pointer
 * handling (`interaction.ts`) agree on the geometry.
 *
 * The note lane's height and grab radius are shared with the analyzer charts — see
 * `components/notes/strip.ts` and `components/notes/lane.ts`.
 */

/** Height of the ruler strip along the top of the canvas. */
export const RULER_H = 22;
/** Horizontal hit distance from a start/end handle that starts a drag. */
export const HANDLE_HIT = 9;
/** Horizontal gap kept between consecutive ruler labels so they never collide. */
export const LABEL_GAP = 8;
/** Vertical hit zone at the top of the waveform for the window move handle. */
export const MOVE_HIT = 10;
/** Height of the drawn window move handle bar. */
export const MOVE_HANDLE_H = 8;
/** Horizontal gutter so the start/end handles never sit on the very edge. */
export const PLOT_PAD = 12;
/** Click-drag preview restart throttle, in ms. */
export const PREVIEW_THROTTLE = 110;
/** Length of the excerpt auditioned while dragging a handle, in seconds. */
export const EDGE_EXCERPT = 0.75;
