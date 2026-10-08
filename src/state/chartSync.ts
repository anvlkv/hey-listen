import { createPluginBus } from "@dschz/solid-uplot";
import type {
  CursorPluginMessageBus,
  FocusSeriesPluginMessageBus,
} from "@dschz/solid-uplot/plugins";

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

/** Bus key used by the cross-tab zoom sync plugin. */
export interface ViewMessageBus {
  view?: ViewMessage;
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

/** The bus type shared by every analyzer chart. */
export type AnalyzerBus = CursorPluginMessageBus &
  FocusSeriesPluginMessageBus &
  ViewMessageBus &
  CursorSyncMessageBus &
  Record<string, unknown>;

/** The one bus shared by every uPlot analyzer tab. */
export const analyzerBus = createPluginBus<AnalyzerBus>();
