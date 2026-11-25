/**
 * Coalesce a burst of work into one run per animation frame, keyed so a newer run
 * replaces an older one.
 *
 * This is the **receiving** half of the cross-window sync (`uiSync.ts`). A window pushes
 * a pointer-rate gesture at up to one patch per throttle window, and each patch costs the
 * *receiving* window real work — a chart repaint for the shared cursor and zoom, an
 * analysis for the window, a store rebuild for the graphs. Two properties matter more
 * than the exact rate:
 *
 * - **A burst is at most one run per key per frame**, so a gesture can never queue more
 *   work than a frame can show.
 * - **Nothing runs while the window is occluded.** WebKit suspends
 *   `requestAnimationFrame` for a covered window while the `ui-state` events themselves
 *   keep being dispatched (the same throttling `chartSync.ts` has to allow for). Applying
 *   each patch as it arrived therefore turned "hover a chart in the popout for a minute"
 *   into hundreds of queued repaints that the main window had to drain when it came back
 *   — the window read as frozen. Deferring to the frame leaves at most one pending run
 *   per key, and that one lands on the first visible frame.
 */

/** Pending runs by key; a newer run for the same key replaces the older one. */
const pending = new Map<string, () => void>();
/** The scheduled frame, or `undefined` when none is pending. */
let frame: number | undefined;
/**
 * Insurance for a window that never paints: a throttled timer still lands the latest
 * value, so the stores cannot wait for a frame that never comes (a fully occluded window
 * may not repaint at all). While visible the frame always wins and clears this.
 */
let fallback: ReturnType<typeof setTimeout> | undefined;

/** How long a pending run may wait for a paint before the timer lands it instead. */
const FALLBACK_MS = 200;

function flush(): void {
  frame = undefined;
  if (fallback !== undefined) {
    clearTimeout(fallback);
    fallback = undefined;
  }
  const runs = [...pending.values()];
  pending.clear();
  // A run may schedule another one (a store write that re-runs an effect); the frame is
  // then armed again, so nothing is lost.
  for (const run of runs) run();
}

/** Run `write` on the next animation frame, replacing any pending run under `key`. */
export function applyOnFrame(key: string, write: () => void): void {
  pending.set(key, write);
  if (frame !== undefined) return;
  frame = requestAnimationFrame(flush);
  fallback = setTimeout(flush, FALLBACK_MS);
}
