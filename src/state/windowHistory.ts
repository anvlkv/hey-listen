import { createEffect, createRoot, createSignal, on } from "solid-js";
import { source } from "./source";
import { reframeWindow, windowEnd, windowStart } from "./timeline";

/**
 * The Timeline's **window history** (D-13): a ring of recently committed analysis
 * windows behind the toolbar's Previous / Next window buttons.
 *
 * It is deliberately not the app's undo/redo (`state/history.ts`, which snapshots the
 * whole editable project) and not the per-session viewport (`viewStart` / `viewEnd`,
 * the zoom/pan of the timeline): navigating history only re-writes the **analysis
 * window**, and restoring an entry leaves every other store alone.
 *
 * Entries are committed on a trailing debounce, so a drag contributes one entry rather
 * than one per pointer frame. Restoring needs no "applying" flag: the debounced commit
 * compares the live window against the entry the cursor points at and no-ops when they
 * match, so a restore never branches the ring.
 */

/** A committed analysis window, in source seconds. */
interface WindowEntry {
  start: number;
  end: number;
}

/** How many committed windows the ring keeps (oldest are dropped first). */
const MAX = 50;
/** A window must settle this long (ms) before it becomes a history entry. */
const COMMIT_MS = 350;
/** Two windows closer than this (seconds) are treated as the same entry. */
const TOLERANCE = 1e-6;

const [entries, setEntries] = createSignal<WindowEntry[]>([]);
/** Index into `entries()` of the window on screen; `-1` while the ring is empty. */
const [cursor, setCursor] = createSignal(-1);

/** Whether two windows are the same entry (a drag's sub-sample jitter is not). */
function sameWindow(a: WindowEntry, b: WindowEntry): boolean {
  return Math.abs(a.start - b.start) <= TOLERANCE && Math.abs(a.end - b.end) <= TOLERANCE;
}

/**
 * Record the live window as the newest entry, unless it is empty or already the
 * current one. A new entry drops the forward branch (`entries.slice(0, cursor + 1)`),
 * the ring is trimmed to `MAX` from the oldest end, and the cursor follows the push.
 */
function commit(): void {
  const entry = { start: windowStart(), end: windowEnd() };
  if (!(entry.end - entry.start > 0)) return;
  const current = entries()[cursor()];
  if (current && sameWindow(current, entry)) return;
  const next = [...entries().slice(0, cursor() + 1), entry].slice(-MAX);
  setEntries(next);
  setCursor(next.length - 1);
}

createRoot(() => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** (Re)arm the trailing commit: the window must settle before it is recorded. */
  function schedule() {
    if (timer != undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      commit();
    }, COMMIT_MS);
  }

  // Every window write (a drag, a resize, a numeric field, an annotation's Analyze)
  // re-arms the timer, so one gesture becomes one entry.
  createEffect(on([windowStart, windowEnd], schedule, { defer: true }));

  // A new source replaces the timeline, so forget the old ring and seed it with the
  // new source's window once that has been written (`resetTimeline` runs right after
  // `setSource`, and the trailing commit waits for both).
  createEffect(
    on(source, () => {
      if (timer != undefined) clearTimeout(timer);
      timer = undefined;
      setEntries([]);
      setCursor(-1);
      schedule();
    }),
  );
});

/** Restore the previous committed window, framing it so it is visible. */
export function previousWindow(): void {
  const target = entries()[cursor() - 1];
  if (!target) return;
  setCursor(cursor() - 1);
  reframeWindow({ start: target.start, end: target.end, frame: true });
}

/** Restore the next committed window, framing it so it is visible. */
export function nextWindow(): void {
  if (cursor() < 0) return;
  const target = entries()[cursor() + 1];
  if (!target) return;
  setCursor(cursor() + 1);
  reframeWindow({ start: target.start, end: target.end, frame: true });
}

/** Whether there is an older entry to restore (the Previous button's enabled state). */
export function canGoBack(): boolean {
  return cursor() > 0;
}

/** Whether there is a newer entry to restore (the Next button's enabled state). */
export function canGoForward(): boolean {
  return cursor() >= 0 && cursor() < entries().length - 1;
}
