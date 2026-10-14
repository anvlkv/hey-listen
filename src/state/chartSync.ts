import { createPluginBus } from "@dschz/solid-uplot";
import type {
  CursorPluginMessageBus,
  FocusSeriesPluginMessageBus,
} from "@dschz/solid-uplot/plugins";
import type { Note } from "../bindings/Note";

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
 * The project's notes on the bus (M14): every note plus the focused note id, so a
 * chart's note plugin can draw its own notes and the one focused note without each
 * chart reaching into the store. Published by `state/notes.ts` whenever the notes or
 * the focus change. See `docs/notes.md`.
 */
export interface NotesMessage {
  notes: Note[];
  focusedId: string | null;
}

/** Bus key used by the note marker plugin. */
export interface NotesMessageBus {
  notes?: NotesMessage;
}

/** The bus type shared by every analyzer chart. */
export type AnalyzerBus = CursorPluginMessageBus &
  FocusSeriesPluginMessageBus &
  ViewMessageBus &
  CursorSyncMessageBus &
  NotesMessageBus &
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
