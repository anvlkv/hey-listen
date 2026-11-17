/**
 * Layout and interaction constants for the Timeline canvas (all in CSS pixels). Kept together so the drawing helpers (`draw.ts`) and the pointer
 * handling (`interaction.ts`) agree on the geometry.
 *
 * The annotation lane's height and grab radius are shared with the analyzer charts — see
 * `components/annotations/strip.ts` and `components/annotations/lane.ts`.
 */

/** Height of the ruler strip along the top of the canvas. */
export const RULER_H = 22;
/** Horizontal hit distance from a start/end handle that starts a drag. */
export const HANDLE_HIT = 9;
/** Horizontal gap kept between consecutive ruler labels so they never collide. */
export const LABEL_GAP = 8;
/** Vertical hit zone at the top of the waveform for the window move handle. */
export const MOVE_HIT = 14;
/** Horizontal travel (px) before a ruler press becomes a window selection instead of a seek. */
export const RULER_DRAG_PX = 3;
/** Height of the drawn window move handle bar (tall enough for its duration label). */
export const MOVE_HANDLE_H = 12;
/** Horizontal gutter so the start/end handles never sit on the very edge. */
export const PLOT_PAD = 12;
/** Width of the channel rail along the left of the waveform (2+ channel sources only). */
export const RAIL_W = 48;
/** Click-drag preview restart throttle, in ms. */
export const PREVIEW_THROTTLE = 110;
/** Length of the excerpt auditioned while dragging a handle, in seconds. */
export const EDGE_EXCERPT = 0.75;
