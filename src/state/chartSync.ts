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

/** Which shared axis a chart's x-range / cursor is synced on. */
export type SyncGroup = "time" | "freq";

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
 * The **preview playhead** on the bus (M14 follow-up): the source second being
 * auditioned, or `null` when nothing is playing. Published by the Timeline's preview
 * controller, so a time chart can draw a rule at it — the preview is then visible on the
 * charts, not just on the Timeline. There is one playhead (the preview loops the shared
 * analysis window), so the message carries no group tag; the frequency-axis `spectrum`
 * simply does not install the plugin.
 *
 * **Read `secs`, not the key.** The bus is a Solid store, and `setData` *merges* an object
 * into an existing key: it notifies the message's **fields**, not the key itself, so a
 * consumer that tracked `data.playhead` alone would fire once and then never again. Every
 * reader of an object-valued key here therefore reads the field it needs (which is also
 * why the `view` / `cursorSync` readers all touch `.group`). See `syncPlugins.ts`.
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
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          resetChartViews();
        }, RESET_DEBOUNCE_MS);
      },
      { defer: true },
    ),
  );
});
