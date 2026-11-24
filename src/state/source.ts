import { invoke } from "../lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { batch, createSignal } from "solid-js";
import { pcmStream } from "../lib/pcmStream";
import type { ProbeInfo } from "../bindings/ProbeInfo";
import type { SourceStorage } from "../bindings/SourceStorage";
import type { StreamSummary } from "../bindings/StreamSummary";
import type { ChannelPick, Peaks } from "../lib/waveform";
import { annotations } from "./annotations/signals";
import { replaceAnnotations } from "./annotations/mutations";
import { askStorage, rememberedStorage, setSourceStorage, syncSourceWatch } from "./sourceStorage";
import {
  resetTimeline,
  setView,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "./timeline";
import { clampViewRange } from "./timelineView";
import { resetChartViews } from "./chartSync";

const BASE_TITLE = "Hey Listen";

/** Reflect the current source in the native window title. */
export async function setWindowTitle(name?: string) {
  try {
    await getCurrentWindow().setTitle(name ? `${name} — ${BASE_TITLE}` : BASE_TITLE);
  } catch {
    // Non-fatal: the title bar is cosmetic.
  }
}

/** Metadata returned by the backend's `probe_file` command (ts-rs binding). */
export type { ProbeInfo };

/**
 * The current project's audio source: PCM backing the timeline. Static for files,
 * growing for live captures.
 */
export interface AudioSource {
  /** Display name (file name, or a label such as "Microphone"). */
  name: string;
  /** Short descriptor (codec, or the source kind). */
  detail: string;
  sampleRate: number;
  channels: number;
  frames: number;
  /** Duration in seconds. */
  duration: number;
  /**
   * Interleaved `f32`. Length is `frames * channels` for files, but capture
   * buffers over-allocate, so read only up to `frames`.
   */
  samples: Float32Array;
  /** Incrementally maintained peaks (capture); files compute them lazily. */
  peaks?: Peaks;
  /** The channel `peaks` was computed for (capture) — see `state/analysis.ts`. */
  peaksChannel?: ChannelPick;
  /** File metadata, when the source is a file. */
  probe?: ProbeInfo;
  /** True while a live capture is still growing. */
  live?: boolean;
  /**
   * Where the audio came from when that matters for editing. `"synth"` marks a source
   * rendered by the synth workflow, so later renders overwrite it in place without a
   * confirmation (ADR-21 / M22).
   */
  origin?: "synth";
}

/**
 * Sources whose audio the core already has loaded/silent, so the transport must not
 * stop playback when they arrive.
 *
 * A synth **Live** write installs the PCM in the core and then hands the frontend the
 * same render: stopping the transport here would silence audio the same command just
 * installed. First adoptions mark the source too, after the workflow has stopped the
 * transport itself.
 */
const transportKept = new WeakSet<AudioSource>();

/** Whether this exact source object must leave the transport alone. */
export function keepsTransport(current: AudioSource | null): boolean {
  return current != null && transportKept.has(current);
}

/** Mark an in-place replacement as already installed by the caller (see above). */
export function markKeepsTransport(current: AudioSource): void {
  transportKept.add(current);
}

export type SourceStatus = "empty" | "probing" | "decoding" | "capturing" | "ready" | "error";

/** One window = one project = one source, so a single source store suffices. */
export const [source, setSource] = createSignal<AudioSource | null>(null);
/**
 * Bumped whenever the source is replaced **wholesale** (the whole timeline changes, so
 * the undo history must not step across it). A live capture's growing buffer is not a
 * replacement, so `setSource` is not itself the trigger.
 */
export const [sourceRevision, setSourceRevision] = createSignal(0);
export const [status, setStatus] = createSignal<SourceStatus>("empty");
export const [error, setError] = createSignal<string | null>(null);

/** Generation counter so a slow open can't clobber a newer one. */
let openToken = 0;

/**
 * Claim the next source-replacement token.
 *
 * Every flow that replaces the source (open a file, load a project, render a synth)
 * takes one, and passes it to the core, which installs the decoded audio only while its
 * request is still the newest. That is what keeps the timeline, playback and analysis on
 * the same audio when two replacements overlap and finish out of order.
 */
export function nextSourceToken(): number {
  return ++openToken;
}

/** The newest claimed token (an older flow compares against it before applying). */
export function currentSourceToken(): number {
  return openToken;
}

/** Clear the timeline and drop the core-owned source PCM (ADR-9). */
export function closeSource() {
  // A newer token also makes any decode still in flight stale in the core.
  const token = nextSourceToken();
  void invoke("clear_audio_source", { requestId: token });
  setSource(null);
  setStatus("empty");
  setError(null);
  resetTimeline(0);
  // The whole timeline changed, so any analyzer zoom no longer applies.
  resetChartViews();
  setSourceRevision((revision) => revision + 1);
  void setWindowTitle();
  // Nothing is left to store as the project's source: go back to the remembered default
  // (the panel preselects it) and stop watching a file the project no longer has.
  setSourceStorage(rememberedStorage());
  void syncSourceWatch();
}

/**
 * Adopt freshly decoded/rendered PCM as the source (replacing the whole timeline)
 * and reset the window/view to cover it.
 */
export function finalizeSource(opts: {
  name: string;
  detail: string;
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  probe?: ProbeInfo;
  origin?: "synth";
  /** Keep the transport as it is (the caller already stopped it or left it playing). */
  keepsTransport?: boolean;
}) {
  const channels = Math.max(1, opts.channels);
  const frames = Math.floor(opts.samples.length / channels);
  const duration = opts.sampleRate > 0 ? frames / opts.sampleRate : 0;
  const next: AudioSource = {
    name: opts.name,
    detail: opts.detail,
    samples: opts.samples,
    frames,
    sampleRate: opts.sampleRate,
    channels,
    duration,
    probe: opts.probe,
    origin: opts.origin,
  };
  if (opts.keepsTransport) transportKept.add(next);
  setSource(next);
  resetTimeline(duration);
  // A replaced source replaces the whole timeline, so drop the analyzer zoom and start a
  // fresh undo history (`state/project/push.ts`).
  resetChartViews();
  setSourceRevision((revision) => revision + 1);
  setStatus("ready");
  void setWindowTitle(opts.name);
}

/** The shortest window an in-place shrink leaves behind (matches the Timeline's floor). */
const MIN_WINDOW_SECONDS = 1e-3;

/**
 * Clamp the analysis window and the viewport into a shrunken source, preserving as much
 * as possible. Growing never moves either.
 */
function clampTimeline(duration: number) {
  const start = Math.max(0, Math.min(windowStart(), duration));
  const end = Math.max(0, Math.min(windowEnd(), duration));
  if (end - start >= MIN_WINDOW_SECONDS) {
    setWindowStart(start);
    setWindowEnd(end);
  } else {
    const span = Math.max(
      MIN_WINDOW_SECONDS,
      Math.min(Math.max(0, windowEnd() - windowStart()), duration),
    );
    const nextEnd = Math.min(duration, Math.max(end, span));
    setWindowStart(Math.max(0, nextEnd - span));
    setWindowEnd(nextEnd);
  }
  const [lo, hi] = clampViewRange(viewStart(), viewEnd(), duration);
  setView(lo, hi);
}

/**
 * Overwrite the current source **in place** (no timeline/window/history reset).
 *
 * The caller has already installed the PCM in the core — a synth render, or a reload of
 * a live-linked file — so the transport may reload rather than stop. `origin` is kept
 * from the current source unless the caller names one, so an in-place file reload of a
 * file source stays a file source.
 */
export function applySourceInPlace(opts: {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  origin?: AudioSource["origin"];
  /** File metadata to replace; omitted, the current source's probe is kept. */
  probe?: ProbeInfo;
}) {
  const current = source();
  if (!current) return;
  const channels = Math.max(1, opts.channels);
  const frames = Math.floor(opts.samples.length / channels);
  const duration = opts.sampleRate > 0 ? frames / opts.sampleRate : 0;
  const next: AudioSource = {
    ...current,
    samples: opts.samples,
    frames,
    sampleRate: opts.sampleRate,
    channels,
    duration,
    origin: opts.origin ?? current.origin,
    probe: opts.probe ?? current.probe,
    live: false,
    peaks: undefined,
    peaksChannel: undefined,
  };
  markKeepsTransport(next);
  // Shrinking can push an annotation past the new end; growing never does.
  const shrunk = duration < current.duration;
  // One batch: the transport and the project push both subscribe to these stores, so a
  // separate write per store would cascade a full pass for each one.
  batch(() => {
    setSource(next);
    clampTimeline(duration);
    if (shrunk) replaceAnnotations(annotations());
  });
}

/**
 * Open a file source: probe it, then stream + assemble the decoded PCM.
 * Replaces any existing source (the whole timeline changes). Returns whether the file
 * became the source (a failed or superseded open returns `false`).
 *
 * `storage` is how the project will keep this audio; omitted, the remembered default
 * applies (an MCP caller names it, the picker dialog asks).
 */
export async function openPath(
  path: string,
  confirm = true,
  storage?: SourceStorage,
): Promise<boolean> {
  // Replacing an existing source discards the timeline (and its analysis window).
  // The MCP server can pass `confirm = false` when the agent explicitly replaces.
  if (confirm && source() != null) {
    const ok = await invoke<boolean>("confirm", {
      message: "Replacing the current source discards the existing audio.",
      title: "Replace source?",
    });
    if (!ok) return false;
  }

  const token = nextSourceToken();
  // Await the clear: it claims `token` in the core, so a decode from an older open still
  // running cannot install after this replacement started.
  await invoke("clear_audio_source", { requestId: token }).catch(() => {});
  setSource(null);
  setError(null);
  setStatus("probing");

  let probe: ProbeInfo;
  try {
    probe = await invoke<ProbeInfo>("probe_file", { path });
  } catch (err) {
    if (token === openToken) {
      setError(String(err));
      setStatus("error");
    }
    return false;
  }
  if (token !== openToken) return false;

  setStatus("decoding");

  // Stream the PCM, then assemble once the core's end-of-stream sentinel arrives
  // (large chunks are delivered asynchronously — see `lib/pcmStream.ts`).
  const stream = pcmStream();
  let summary: StreamSummary;
  try {
    summary = await invoke<StreamSummary>("stream_file", {
      path,
      requestId: token,
      onChunk: stream.channel,
    });
    await stream.done;
  } catch (err) {
    if (token === openToken) {
      setError(String(err));
      setStatus("error");
    }
    return false;
  }
  if (token !== openToken) return false;

  const samples = stream.samples();
  const channels = Math.max(1, summary.channels);

  finalizeSource({
    name: probe.name,
    detail: probe.codec,
    samples,
    sampleRate: summary.sampleRate,
    channels,
    probe,
  });
  // The audio is this file's now, stored the way the user (or a script) asked — or the
  // way they last chose. A live link then starts the core's watcher on it.
  setSourceStorage(storage ?? rememberedStorage());
  void syncSourceWatch();
  return true;
}

/** Show the native file picker, ask how to store the audio, and open the chosen file. */
export async function openFileDialog() {
  const path = await invoke<string | null>("pick_audio_file");
  if (!path) return;
  const storage = await askStorage(path);
  // A cancelled chooser cancels the open, not just the mode.
  if (!storage) return;
  await openPath(path, true, storage);
}
