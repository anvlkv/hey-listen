import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal } from "solid-js";
import { setPreviewSource } from "../audio/playback";
import type { ChannelPick, Peaks } from "../lib/waveform";
import { resetTimeline } from "./timeline";

const BASE_TITLE = "Hey Listen";

/** Reflect the current source in the native window title. */
async function setWindowTitle(name?: string) {
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

/** Clear the timeline and release the preview buffer. */
export function closeSource() {
  openToken++;
  setPreviewSource(null, 44_100, 1);
  setSource(null);
  setStatus("empty");
  setError(null);
  resetTimeline(0);
  void setWindowTitle();
}

/**
 * Open a file source: probe it, then stream + assemble the decoded PCM.
 * Replaces any existing source (the whole timeline changes).
 */
export async function openPath(path: string) {
  const token = ++openToken;
  setPreviewSource(null, 44_100, 1);
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

  // Collect streamed chunks, then concatenate once (avoids O(n^2) growth).
  const chunks: Float32Array[] = [];
  let total = 0;
  const onChunk = new Channel<ArrayBuffer>();
  onChunk.onmessage = (raw) => {
    const chunk = new Float32Array(raw);
    chunks.push(chunk);
    total += chunk.length;
  };

  let summary: StreamSummary;
  try {
    summary = await invoke<StreamSummary>("stream_file", { path, onChunk });
  } catch (err) {
    if (token === openToken) {
      setError(String(err));
      setStatus("error");
    }
    return;
  }
  if (token !== openToken) return;

  const samples = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }

  const channels = Math.max(1, summary.channels);
  const frames = Math.floor(total / channels);
  const duration = summary.sampleRate > 0 ? frames / summary.sampleRate : 0;

  setPreviewSource(samples, summary.sampleRate, channels);
  setSource({
    name: probe.name,
    detail: probe.codec,
    samples,
    frames,
    sampleRate: summary.sampleRate,
    channels,
    duration,
    probe,
  });
  resetTimeline(duration);
  setStatus("ready");
  void setWindowTitle(probe.name);
}

/** Show the native file picker and open the chosen file, if any. */
export async function openFileDialog() {
  const path = await invoke<string | null>("pick_audio_file");
  if (path) await openPath(path);
}
