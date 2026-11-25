import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { AudioExportArgs } from "../bindings/AudioExportArgs";
import type { AudioExportChannels } from "../bindings/AudioExportChannels";
import type { AudioExportDepth } from "../bindings/AudioExportDepth";
import type { AudioExportFormat } from "../bindings/AudioExportFormat";
import type { ExportedAudio } from "../bindings/ExportedAudio";
import { invoke } from "../lib/ipc";
import { channelOptions } from "./analysis";
import { filterActive, filterComposed, filterOutputs, filterSpec } from "./graph";
import { source } from "./source";
import { windowEnd, windowStart } from "./timeline";

/**
 * Audio export (M43): the Export rail's store.
 *
 * It exports the **current analysis window** of the project source. The call never
 * changes the source, the app's filter switch, or the window. Format and depth are
 * remembered app-level (like the font scale) so the next export starts where the last
 * one ended; the depth choice is kept **per format** (changing format snaps the depth to
 * a supported value).
 */

/** The depths each format can write, in display order. */
export function depthsFor(format: AudioExportFormat): AudioExportDepth[] {
  return format === "wav" ? ["f32", "i16", "i24", "i32"] : ["i16", "i24"];
}

/** A depth's display label. */
export const DEPTH_LABELS: Record<AudioExportDepth, string> = {
  f32: "32-bit float",
  i16: "16-bit",
  i24: "24-bit",
  i32: "32-bit integer",
};

/** A format's display label. */
export const FORMAT_LABELS: Record<AudioExportFormat, string> = {
  wav: "WAV",
  flac: "FLAC",
  aiff: "AIFF",
};

/** The channel modes, in display order. */
export const CHANNEL_MODE_LABELS: Record<AudioExportChannels, string> = {
  all: "All channels",
  mono: "Downmix (mono)",
  single: "Single channel",
};

const STORAGE_KEY = "hey-listen:audio-export";

interface ExportPrefs {
  format: AudioExportFormat;
  /** The depth last chosen for each format. */
  depths: Partial<Record<AudioExportFormat, AudioExportDepth>>;
}

/** The app-level default depth for a format. */
function defaultDepth(format: AudioExportFormat): AudioExportDepth {
  return format === "wav" ? "f32" : "i16";
}

function loadPrefs(): ExportPrefs {
  const fallback: ExportPrefs = { format: "wav", depths: { wav: "f32", flac: "i16", aiff: "i16" } };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as Partial<ExportPrefs>;
    const format = parsed.format === "flac" || parsed.format === "aiff" ? parsed.format : "wav";
    return { format, depths: { ...fallback.depths, ...(parsed.depths ?? {}) } };
  } catch {
    return fallback;
  }
}

const initial = loadPrefs();

/** The exported format. */
export const [exportFormat, setExportFormatSignal] = createSignal<AudioExportFormat>(
  initial.format,
);

/** The remembered depth per format (the current one is `depths[exportFormat()]`). */
const [depths, setDepths] = createStore<Partial<Record<AudioExportFormat, AudioExportDepth>>>(
  initial.depths,
);

/** The depth for the current format, snapped to one it supports. */
export function exportDepth(): AudioExportDepth {
  const format = exportFormat();
  const chosen = depths[format];
  return chosen && depthsFor(format).includes(chosen) ? chosen : defaultDepth(format);
}

function persist() {
  try {
    const prefs: ExportPrefs = { format: exportFormat(), depths };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not persisting is fine; the choices still apply for this session.
  }
}

/** Choose a format; the depth snaps to a supported value for it. */
export function setExportFormat(format: AudioExportFormat) {
  setExportFormatSignal(format);
  persist();
}

/** Choose the current format's depth. */
export function setExportDepth(depth: AudioExportDepth) {
  if (!depthsFor(exportFormat()).includes(depth)) return;
  setDepths(exportFormat(), depth);
  persist();
}

/** How the file's channels are chosen. */
export const [exportChannels, setExportChannels] = createSignal<AudioExportChannels>("all");
/** The 0-based lane for `single`. */
export const [exportChannel, setExportChannel] = createSignal(0);
/** Apply the composed filter graph to the export (independent of the app switch). */
export const [exportApplyFilter, setExportApplyFilter] = createSignal(false);

/** Whether the export should run the graph: asked for *and* a graph is composed. */
export function filteringExport(): boolean {
  return exportApplyFilter() && filterComposed();
}

/**
 * The lanes a single-channel export can pick: the graph's **outputs** when the filter is
 * applied, else the source channels — the same lanes the Timeline draws (`channelOptions`
 * labels them).
 */
export function exportLaneCount(): number {
  return filteringExport() ? Math.max(1, filterOutputs()) : Math.max(1, source()?.channels ?? 1);
}

/** The single-channel choices, labelled like the Timeline's lanes. */
export function exportChannelChoices() {
  const lanes = exportLaneCount();
  return channelOptions(lanes, filteringExport() ? lanes : 0)
    .filter((option) => option.value !== "mix")
    .map((option) => ({ value: option.value as number, label: option.label }));
}

/** Why the export cannot run, or `null` when it can. */
export function blockedReason(): string | null {
  if (!source()) return "Open an audio source first.";
  if (!(windowEnd() > windowStart())) return "The analysis window is empty.";
  return null;
}

/** The current export result (the last written file). */
export const [exportedAudio, setExportedAudio] = createSignal<ExportedAudio | null>(null);
/** A failure from the last export attempt. */
export const [exportError, setExportError] = createSignal<string | null>(null);
/** Whether an export is running. */
export const [exporting, setExporting] = createSignal(false);

/** A suggested file name: the source stem plus the format's extension. */
export function exportFileName(): string {
  const name = source()?.name ?? "audio";
  const stem =
    name
      .replace(/\.[^./\\]+$/, "")
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "export";
  const extension = exportFormat() === "aiff" ? "aiff" : exportFormat();
  return `${stem}.${extension}`;
}

/**
 * Ask for a destination and export the analysis window there. Returns the written file,
 * or `null` when the user cancelled the save dialog.
 */
export async function exportAudio(): Promise<ExportedAudio | null> {
  const reason = blockedReason();
  if (reason) {
    setExportError(reason);
    return null;
  }
  const path = await invoke<string | null>("pick_audio_export_path", {
    format: exportFormat(),
    defaultName: exportFileName(),
  });
  if (!path) return null;

  const applyFilter = filteringExport();
  const args: AudioExportArgs = {
    path,
    start: windowStart(),
    end: windowEnd(),
    format: exportFormat(),
    depth: exportDepth(),
    channels: exportChannels(),
    channel: exportChannels() === "single" ? exportChannel() : null,
    applyFilter,
    // The composed spec, so a pending frontend debounce cannot be lost.
    filter: applyFilter ? filterSpec() : null,
  };

  setExporting(true);
  setExportError(null);
  setExportedAudio(null);
  try {
    const exported = await invoke<ExportedAudio>("export_audio", { args });
    setExportedAudio(exported);
    return exported;
  } catch (err) {
    setExportError(String(err));
    return null;
  } finally {
    setExporting(false);
  }
}

/** The filter default for the rail: the app's current filter state. */
export function defaultExportFilter(): boolean {
  return filterActive();
}
