import { batch, createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
import { returnToStart, seek, transportPosition } from "../../audio/preview";
import type { TransportStatus } from "../../audio/transport";
import { source } from "../../state/source";
import { nextWindow, previousWindow } from "../../state/windowHistory";
import { windowEnd, windowStart } from "../../state/timeline";
import { nudgeStep, playheadAnnouncement, windowAnnouncement } from "./announce";

/**
 * The Timeline canvas's **accessibility controller** (D-14): the keyboard map that drives
 * the transport from a focused canvas, plus the text of the polite live region
 * (`[data-testid="timeline.announce"]`). It lives beside the canvas rather than in
 * `Timeline.tsx` so the component stays a composition root, and it reads the pure sentences
 * from `./announce` so the copy is unit-testable.
 *
 * These are the **canvas-local** bindings only — they fire while the canvas owns focus.
 * M24's command registry will own the app-level map (scopes, rebinding, the palette) and
 * will dispatch into the same transport actions; nothing here should grow a second
 * global listener.
 */

/** A window change must settle this long (ms) before it is announced — one per gesture. */
const WINDOW_ANNOUNCE_MS = 400;

/** What the controller reads from the Timeline. */
export interface TimelineAccessibilityDeps {
  /** The visible span (seconds), for one arrow-key nudge. */
  span: Accessor<number>;
  /** The source duration (seconds), for `End`. */
  duration: Accessor<number>;
  /** The transport status (`preview.status`): a pause/stop is announced once, not per tick. */
  status: Accessor<TransportStatus>;
}

/** The canvas's `keydown` handler and the live region's current text. */
export interface TimelineAccessibility {
  /** The sentence in the polite live region; an unchanged one is not repeated. */
  announcement: Accessor<string>;
  /** The focused canvas's `keydown` handler (unhandled keys keep their default). */
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Build the controller: the live region's signal, its two announcement effects and the
 * keyboard map. Arrow keys nudge the playhead, `Home` / `End` go to the source's ends and
 * `PageUp` / `PageDown` step the analysis-window history; each announces what moved.
 */
export function createTimelineAccessibility(
  deps: TimelineAccessibilityDeps,
): TimelineAccessibility {
  const [announcement, setAnnouncement] = createSignal("");

  /** Publish a sentence; an identical one is not re-announced. */
  function announce(next: string) {
    if (next !== announcement()) setAnnouncement(next);
  }

  const announcePlayhead = () => announce(playheadAnnouncement(transportPosition()));
  const announceWindow = () => announce(windowAnnouncement(windowStart(), windowEnd()));

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

  function onKeyDown(event: KeyboardEvent) {
    if (!source()) return;
    batch(() => {
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          const step = nudgeStep(deps.span()) * (event.shiftKey ? 10 : 1);
          seek(transportPosition() + (event.key === "ArrowLeft" ? -step : step));
          announcePlayhead();
          break;
        }
        case "Home":
          returnToStart();
          announcePlayhead();
          break;
        case "End":
          seek(deps.duration());
          announcePlayhead();
          break;
        case "PageUp":
          previousWindow();
          announceWindow();
          break;
        case "PageDown":
          nextWindow();
          announceWindow();
          break;
        default:
          // Not a canvas binding: leave the default action (scrolling, typing, …) alone.
          return;
      }
      event.preventDefault();
    });
  }

  return { announcement, onKeyDown };
}
