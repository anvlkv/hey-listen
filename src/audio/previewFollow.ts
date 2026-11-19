import type { TransportRegion } from "./transport";

/** Trailing debounce before a moved analysis window reloads the looped region, in ms. */
const FOLLOW_DEBOUNCE_MS = 200;

/** The transport's window-follow state; see `createWindowFollow`. */
export interface WindowFollow {
  /** Whether the loaded region tracks the analysis window. */
  active: boolean;
  /** Drop a pending reload (a stop, an explicit region, or a new source). */
  cancel(): void;
  /** Called with the previous window when `windowStart`/`windowEnd` change. */
  onChange(previous: readonly number[]): void;
}

/**
 * Keep a playing preview on the analysis window (M23): when the window moves — by the
 * Timeline's move handle, a chart's *Reframe* menu, Analyze, or MCP `set_window` — the
 * region reloads once the move settles (debounced like the analysis auto-run), resuming at
 * the equivalent position.
 *
 * A preview follows from an explicit window preview, or when it is playing **exactly** the
 * window that just moved — never a sub-range excerpt. Only a playing transport follows; a
 * paused or idle one keeps its region until the user resumes.
 */
export function createWindowFollow(deps: {
  /** Whether the transport is playing. */
  isPlaying: () => boolean;
  /** The region currently loaded in the core. */
  loaded: () => TransportRegion;
  /** Reload the region (the transport store's `refreshPreview`). */
  refresh: () => void;
}): WindowFollow {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const follow: WindowFollow = {
    active: false,
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    onChange(previous) {
      if (!deps.isPlaying()) return;
      const loaded = deps.loaded();
      const atStart = Math.abs(loaded.start - previous[0]) < 1e-6;
      const atEnd = Math.abs(loaded.end - previous[1]) < 1e-6;
      if (!follow.active && !(atStart && atEnd)) return;
      follow.active = true;
      follow.cancel();
      timer = setTimeout(() => {
        timer = undefined;
        if (!deps.isPlaying() || !follow.active) return;
        deps.refresh();
      }, FOLLOW_DEBOUNCE_MS);
    },
  };
  return follow;
}
