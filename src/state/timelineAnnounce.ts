import { createSignal } from "solid-js";
import { transportPosition } from "../audio/preview";
import { playheadAnnouncement, windowAnnouncement } from "../components/timeline/announce";
import { windowEnd, windowStart } from "./timeline";

/**
 * The Timeline's ARIA live-region text, at store level so the command registry can
 * announce a seek or a window step ([`hotkeys.md`](../../../docs/hotkeys.md) →
 * "Guards"). `createTimelineAccessibility` renders the accessor; the announcements are
 * deduplicated, so repeating the same playhead time is silent.
 */
const [timelineAnnouncement, setTimelineAnnouncement] = createSignal("");
export { timelineAnnouncement };

/** Publish a sentence; an identical one is not re-announced. */
function announce(next: string) {
  if (next !== timelineAnnouncement()) setTimelineAnnouncement(next);
}

/** Announce the current playhead position. */
export function announcePlayhead() {
  announce(playheadAnnouncement(transportPosition()));
}

/** Announce the current analysis window. */
export function announceWindow() {
  announce(windowAnnouncement(windowStart(), windowEnd()));
}
