import { createSignal } from "solid-js";

/**
 * The Timeline's **follow-playhead** toggle (D-03): when it is on, the Timeline scrolls its
 * viewport to keep a **playing** playhead visible (it pages by ~8% of the visible span, so
 * the line never sits on the very edge).
 *
 * Like the transport's speed this is a session preference — session-only, never persisted,
 * and never project content: it changes what is on screen, not what is analyzed. The `F`
 * binding lands with M24; until then the toolbar button is the only control.
 */

/** Whether the Timeline follows a playing playhead. */
export const [transportFollow, setTransportFollow] = createSignal(false);

/** Flip the follow-playhead preference. */
export function toggleTransportFollow(): void {
  setTransportFollow((on) => !on);
}
