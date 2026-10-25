import { createEffect, createRoot, on } from "solid-js";
import { createPluginBus } from "@dschz/solid-uplot";
import type {
  CursorPluginMessageBus,
  FocusSeriesPluginMessageBus,
} from "@dschz/solid-uplot/plugins";
import type { Note } from "../bindings/Note";
import { windowEnd, windowStart } from "./timeline";

/**
 * Shared chart state for cross-tab sync (M5).
 *
 * Every analyzer chart shares **one** `createPluginBus`, so a chart can mirror the
 * cursor of whichever tab is hovered and follow its zoom. Two extra keys ride on
 * the bus on top of solid-uplot's own `cursor`/`focusSeries`:
 *
 * - `view` — the x-range a chart was zoomed to; charts on the same [`SyncGroup`]
 *   follow each other.
 * - `cursorSync` — the hovered x value, tagged with its group, so a time cursor is
 *   never mirrored onto a frequency chart (and vice versa).
 *
 * See `docs/ui-layout.md`.
 */

/**
 * Which shared axis a chart's x-range / cursor is synced on: time (most tools),
 * audio frequency (spectrum), or modulation rate (the M20 modulation spectra).
 */
export type SyncGroup = "time" | "freq" | "mod";

/** A published x-range for a group, tagged with the chart that set it. */
export interface ViewMessage {
  sourceId: string;
  group: SyncGroup;
  x: [number, number];
}

/** Bus key used by the cross-tab zoom sync plugin. `null` means "no shared
 * view" (each chart fits its own data) — set when the source is replaced. */
export interface ViewMessageBus {
  view?: ViewMessage | null;
}

/** A published cursor x value (seconds / Hz), tagged with its group. */
export interface CursorSyncMessage {
  sourceId: string;
  group: SyncGroup;
  /** The x value under the pointer, or `null` when the pointer left the chart. */
  x: number | null;
}

/** Bus key used by the cross-tab cursor mirror plugin. */
export interface CursorSyncMessageBus {
  cursorSync?: CursorSyncMessage;
}

/**
 * The project's notes on the bus (M14): every note, the focused note id, and whether the
 * Notes rail is open, so a chart's note plugin can draw its own notes and the one focused
 * note without each chart reaching into the store. Published by `state/notes/` whenever
 * the notes, the focus or the panel change. `panelOpen` drives the *dull* rendering used
 * when the rail is closed. See `docs/notes.md`.
 */
export interface NotesMessage {
  notes: Note[];
  focusedId: string | null;
  panelOpen: boolean;
}

/** Bus key used by the note marker plugin. */
export interface NotesMessageBus {
  notes?: NotesMessage;
}

/**
 * Read a bus message for a consumer, **all of its fields at once**.
 *
 * Two Solid-store rules make this worth centralising — both bit a chart (see the M14
 * follow-up in `docs/roadmap.md`):
 *
 * - `setData` *merges* a message into its key, so only the message's **fields** notify
 *   their readers: an effect that tracked the key alone fired once and then never again;
 * - an effect keeps only the dependencies **its last run read**, so a reader that returned
 *   early on one field (the group tag, say) *dropped* the others and stopped firing when
 *   the position moved — it went on mirroring the position it had last drawn.
 *
 * Spreading the message reads every field in every run, whichever guard the caller applies
 * afterwards, and hands back a plain snapshot so the caller cannot half-read it again.
 * `null` means no message.
 */
export function readBusMessage<T extends object>(message: T | null | undefined): T | null {
  return message ? ({ ...message } as T) : null;
}

/**
 * The **preview playhead** on the bus (M14 follow-up): the source second being
 * auditioned, or `null` when nothing is playing. Published by the Timeline's preview
 * controller, so a time chart can draw a rule at it — the preview is then visible on the
 * charts, not just on the Timeline. There is one playhead (the preview loops the shared
 * analysis window), so the message carries no group tag; the frequency-axis `spectrum`
 * simply does not install the plugin.
 *
 * **Read the fields, not the key.** The bus is a Solid store, and `setData` *merges* an object
 * into an existing key: it notifies the message's **fields**, not the key itself, so a
 * consumer that tracked `data.playhead` alone would fire once and then never again. Every
 * reader of a bus message here goes through [`readBusMessage`], which reads *all* the
 * fields in every run — an early return before touching one of them would silently drop it
 * from the effect. See `syncPlugins.ts`.
 */
export interface PlayheadMessage {
  /** The source second now playing, or `null` when the preview stopped. */
  secs: number | null;
}

/** Bus key used by the preview playhead plugin. */
export interface PlayheadMessageBus {
  playhead?: PlayheadMessage;
}

/** The bus type shared by every analyzer chart. */
export type AnalyzerBus = CursorPluginMessageBus &
  FocusSeriesPluginMessageBus &
  ViewMessageBus &
  CursorSyncMessageBus &
  NotesMessageBus &
  PlayheadMessageBus &
  Record<string, unknown>;

/** The one bus shared by every uPlot analyzer tab. */
export const analyzerBus = createPluginBus<AnalyzerBus>();

/**
 * Counts the views published by a **user action** (zoom / pan / fit). Used to let a
 * newer zoom supersede a pending re-fit: a timer armed by a window move must not wipe
 * a view the user set after it — timers can run late (WebKit throttles them for an
 * occluded window; the CI window is one), so this is not theoretical.
 */
let viewRevision = 0;

/** Publish a chart's visible x-range for its sync group (a user zoom / pan / fit). */
export function publishChartView(message: ViewMessage) {
  viewRevision++;
  analyzerBus.setData("view", message);
}

/**
 * Drop the shared x-view for both groups so every chart fits its own data again.
 * Called when the source is replaced: the previous zoom no longer applies to the
 * new (whole-timeline) audio.
 */
export function resetChartViews() {
  analyzerBus.setData("view", null);
}

/** How long the analysis window must settle before the charts drop their zoom. */
const RESET_DEBOUNCE_MS = 120;

// The analysis window **is** a time chart's natural x extent, so moving it must re-fit
// every chart. Two things otherwise leave a chart stuck on a stale range: the heatmaps
// clamp the range they were showing into the new extent, and the uPlot charts re-apply
// the shared range after the `setData` that follows uPlot's own fit. Clearing the shared
// view is the same "fit your own data" signal the source replacement sends (and it
// propagates to the sibling windows through `uiState`). See `chartInteraction.ts`.
//
// It is **debounced on the settle**, not fired per change: the window moves on every
// pointermove of a drag, while the data a chart would re-fit to only arrives when the
// (itself debounced) analysis lands ~200 ms later — so clearing the view per move re-fits
// and repaints every open chart for nothing, and pushes that to the project's other
// windows each time. That per-move work is what made a window drag unusable.
createRoot(() => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      [windowStart, windowEnd],
      () => {
        // A chart zoomed *after* the window changed owns the view: clear only the range
        // that predates the move. The timer can fire long after it was armed (WebKit
        // throttles timers in an occluded window), by which time the user may have
        // zoomed — a late clear would then silently undo that zoom.
        const revision = viewRevision;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          if (viewRevision === revision) resetChartViews();
        }, RESET_DEBOUNCE_MS);
      },
      { defer: true },
    ),
  );
});
