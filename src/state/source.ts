import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";
import { pcmStream } from "../lib/pcmStream";
import type { ChannelPick, Peaks } from "../lib/waveform";
import { resetTimeline } from "./timeline";

const BASE_TITLE = "Hey Listen";

/** Reflect the current source in the native window title. */
export async function setWindowTitle(name?: string) {
  try {
    await getCurrentWindow().setTitle(name ? `${name} — ${BASE_TITLE}` : BASE_TITLE);
  } catch {
    // Non-fatal: the title bar is cosmetic.
  }
}

/** Metadata returned by the backend's `probe_file` command. */
export interface ProbeInfo {
  path: string;
  name: string;
  codec: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number | null;
  numFrames: number | null;
  durationSecs: number | null;
}

/** Summary returned once the backend finished streaming a decoded file. */
interface StreamSummary {
  sampleRate: number;
  channels: number;
  frames: number;
}

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
}

export type SourceStatus = "empty" | "probing" | "decoding" | "capturing" | "ready" | "error";

/** One window = one project = one source, so a single source store suffices. */
export const [source, setSource] = createSignal<AudioSource | null>(null);
export const [status, setStatus] = createSignal<SourceStatus>("empty");
export const [error, setError] = createSignal<string | null>(null);

/** Generation counter so a slow open can't clobber a newer one. */
let openToken = 0;

/** Clear the timeline and drop the core-owned source PCM (ADR-9). */
export function closeSource() {
  openToken++;
  void invoke("clear_audio_source");
  setSource(null);
  setStatus("empty");
  setError(null);
  resetTimeline(0);
  void setWindowTitle();
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
}) {
  const channels = Math.max(1, opts.channels);
  const frames = Math.floor(opts.samples.length / channels);
  const duration = opts.sampleRate > 0 ? frames / opts.sampleRate : 0;
  setSource({
    name: opts.name,
    detail: opts.detail,
    samples: opts.samples,
    frames,
    sampleRate: opts.sampleRate,
    channels,
    duration,
    probe: opts.probe,
  });
  resetTimeline(duration);
  setStatus("ready");
  void setWindowTitle(opts.name);
}

/**
 * Open a file source: probe it, then stream + assemble the decoded PCM.
 * Replaces any existing source (the whole timeline changes).
 */
export async function openPath(path: string) {
  const token = ++openToken;
  void invoke("clear_audio_source");
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
    return;
  }
  if (token !== openToken) return;

  setStatus("decoding");

  // Stream the PCM, then assemble once the core's end-of-stream sentinel arrives
  // (large chunks are delivered asynchronously — see `lib/pcmStream.ts`).
  const stream = pcmStream();
  let summary: StreamSummary;
  try {
    summary = await invoke<StreamSummary>("stream_file", { path, onChunk: stream.channel });
    await stream.done;
  } catch (err) {
    if (token === openToken) {
      setError(String(err));
      setStatus("error");
    }
    return;
  }
  if (token !== openToken) return;

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
}

/** Show the native file picker and open the chosen file, if any. */
export async function openFileDialog() {
  const path = await invoke<string | null>("pick_audio_file");
  if (path) await openPath(path);
}
