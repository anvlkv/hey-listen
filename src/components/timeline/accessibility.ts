import { createEffect, on, onCleanup, type Accessor } from "solid-js";
import type { TransportStatus } from "../../audio/transport";
import { source } from "../../state/source";
import { windowEnd, windowStart } from "../../state/timeline";
import {
  announcePlayhead,
  announceWindow,
  timelineAnnouncement,
} from "../../state/timelineAnnounce";

/**
 * The Timeline's **accessibility controller** (D-14): the two announcement effects and
 * the text of the polite live region (`[data-testid="timeline.announce"]`). The keyboard
 * map now lives in the app-wide command registry (M24.B), so this module only watches
 * state and answers with the store's sentences.
 */

/** A window change must settle this long (ms) before it is announced — one per gesture. */
const WINDOW_ANNOUNCE_MS = 400;

/** What the controller reads from the Timeline. */
export interface TimelineAccessibilityDeps {
  /** The transport status (`preview.status`): a pause/stop is announced once, not per tick. */
  status: Accessor<TransportStatus>;
}

/** The live region's current text. */
export interface TimelineAccessibility {
  /** The sentence in the polite live region; an unchanged one is not repeated. */
  announcement: Accessor<string>;
}

/**
 * Build the controller: watch the window and the transport, announcing each change once it
 * is meaningful (a settled window, a pause/stop rather than every playback tick).
 */
export function createTimelineAccessibility(
  deps: TimelineAccessibilityDeps,
): TimelineAccessibility {
  // A window change (a drag, a chart's Reframe, PageUp/PageDown) is announced once it
  // settles, so a drag reads as one sentence rather than one per pointer frame.
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      [windowStart, windowEnd],
      () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          if (source()) announceWindow();
        }, WINDOW_ANNOUNCE_MS);
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  // Leaving "playing" (pause, stop, end of the region) is announced once; the ~60 fps
  // position ticks never are — that would flood the live region while it plays.
  createEffect(
    on(deps.status, (status, previous) => {
      if (previous === "playing" && status !== "playing" && source()) announcePlayhead();
    }),
  );

  return { announcement: timelineAnnouncement };
}
