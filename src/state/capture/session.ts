import { Channel } from "@tauri-apps/api/core";
import { invoke } from "../../lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createEffect, createRoot, on } from "solid-js";
import { PeakAccumulator } from "../../lib/waveform";
import type { CaptureInfo } from "../../bindings/CaptureInfo";
import type { CaptureEvent } from "../../bindings/CaptureEvent";
import { channel, channelFor } from "../analysis";
import { closeSource, setError, setSource, setStatus, source } from "../source";
import { resetTimeline, setView, setWindowEnd, setWindowStart } from "../timeline";
import { finishCountdown, runCountdown } from "./countdown";
import {
  choice,
  countdown,
  deviceId,
  gain,
  mixMicDeviceId,
  mixSystemDeviceId,
  paused,
  recording,
  setCaptureError,
  setElapsed,
  setGainLevel,
  setLevel,
  setMonitoring,
  setPaused,
  setRecording,
  startDelay,
  targetDuration,
  targetPid,
} from "./signals";
import { KIND_LABEL, type CaptureKind } from "./types";

/**
 * Live-capture session engine (flexaudio sources): the growing PCM buffer, the
 * input meter, the recording controls, and the `source_status` subscription. Part
 * of the capture store; see `capture/index.ts` for the public surface and
 * `docs/source-model.md`.
 *
 * A capture **session** is opened as soon as a live kind is selected, so the input
 * meter is live even when idle (monitoring); pressing Record reuses that session
 * and starts appending chunks to the timeline.
 */

/** Payload of the `source_status` event (ts-rs binding). */
type CaptureStatusEvent = CaptureEvent;

const STATUS_TEXT: Record<string, string> = {
  permission: "capture permission denied",
  "device-lost": "the capture device was lost",
  stalled: "capture stalled",
  dropped: "some capture chunks were dropped",
  recovered: "capture recovered",
};

/** Seconds of headroom in the initial capture buffer (it doubles as needed). */
const INITIAL_FRAMES = 48_000 * 8;

interface Session {
  kind: CaptureKind;
  samples: Float32Array;
  capacityFrames: number;
  frames: number;
  channels: number;
  sampleRate: number;
  peaks: PeakAccumulator;
}

let session: Session | null = null;
let pendingChunks: Float32Array[] = [];
let raf = 0;
/** While true, the timeline window/view auto-extend to the growing end. */
let follow = true;
let unlisten: UnlistenFn | null = null;

/**
 * Subscribe to capture status events. Device enumeration is **not** done here — it
 * is deferred until a live kind is selected (see `refreshDevices`).
 */
export async function initCapture() {
  try {
    unlisten = await listen<CaptureStatusEvent>("source_status", (event) => {
      const { kind, message } = event.payload;
      if (kind === "recovered") {
        setCaptureError(null);
        return;
      }
      setCaptureError(message ?? STATUS_TEXT[kind] ?? kind);
    });
  } catch (err) {
    console.error("could not subscribe to source_status", err);
  }
}

export function disposeCapture() {
  void haltSession();
  unlisten?.();
  unlisten = null;
}

/** Stop auto-following the growing end (called when the user zooms/pans/drags). */
export function stopFollowing() {
  follow = false;
}

/** Largest absolute sample in a chunk, for the input meter. */
function chunkPeak(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const value = Math.abs(data[i]);
    if (value > peak) peak = value;
  }
  return peak;
}

function handleChunk(data: Float32Array) {
  if (!session) {
    pendingChunks.push(data);
    return;
  }
  appendChunk(session, data);
}

function appendChunk(target: Session, data: Float32Array) {
  // The meter always follows the live input, whether or not we are recording.
  setLevel((previous) => Math.max(chunkPeak(data), previous * 0.6));
  if (!recording()) return;

  const frames = Math.floor(data.length / target.channels);
  if (frames <= 0) return;
  const needed = target.frames + frames;

  if (needed > target.capacityFrames) {
    let capacity = Math.max(target.capacityFrames, INITIAL_FRAMES);
    while (needed > capacity) capacity *= 2;
    const grown = new Float32Array(capacity * target.channels);
    grown.set(target.samples.subarray(0, target.frames * target.channels));
    target.samples = grown;
    target.capacityFrames = capacity;
  }

  const chunk = data.subarray(0, frames * target.channels);
  target.samples.set(chunk, target.frames * target.channels);
  target.peaks.push(chunk);
  target.frames = needed;
}

function publish(source: Session, live: boolean) {
  setSource({
    name: KIND_LABEL[source.kind],
    detail: "live capture",
    sampleRate: source.sampleRate,
    channels: source.channels,
    frames: source.frames,
    duration: source.sampleRate > 0 ? source.frames / source.sampleRate : 0,
    samples: source.samples,
    peaks: source.peaks.view(),
    peaksChannel: source.peaks.pick,
    live,
  });
}

/** Rebuild the incremental envelope after the channel selection changes. */
function rebuildPeaks() {
  const target = session;
  if (!target) return;
  target.peaks = new PeakAccumulator(target.channels, channelFor(target.channels));
  if (target.frames > 0) {
    target.peaks.push(target.samples.subarray(0, target.frames * target.channels));
  }
  const current = source();
  if (current && current.samples === target.samples) publish(target, recording());
}

// Singleton store: re-derive the envelope whenever the analysis channel changes.
createRoot(() => {
  createEffect(on(channel, () => rebuildPeaks(), { defer: true }));
});

function tick() {
  raf = requestAnimationFrame(tick);
  const target = session;
  if (!target) return;

  const duration = target.sampleRate > 0 ? target.frames / target.sampleRate : 0;
  setElapsed(duration);
  if (follow && duration > 0) {
    setWindowStart(0);
    setWindowEnd(duration);
    setView(0, duration);
  }
  publish(target, true);

  const limit = targetDuration();
  if (limit > 0 && duration >= limit) void stopCapture();
}

/** Close the capture session and reset the state derived from it. */
async function haltSession() {
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  if (session) {
    try {
      await invoke("stop_capture");
    } catch {
      // Nothing was running; ignore.
    }
  }
  session = null;
  pendingChunks = [];
  void invoke("end_capture_source");
  setMonitoring(false);
  setLevel(0);
}

/** Open a capture session for the current configuration, if one is not already open. */
async function ensureSession(): Promise<boolean> {
  if (session) return true;

  const kind = choice();
  if (kind === "file" || kind === "synth") return false;
  if (kind === "process" && targetPid() == null) return false;

  const onChunk = new Channel<ArrayBuffer>();
  onChunk.onmessage = (raw) => handleChunk(new Float32Array(raw));

  pendingChunks = [];
  let info: CaptureInfo;
  try {
    info = await invoke<CaptureInfo>("start_capture", {
      args: {
        kind,
        deviceId: kind === "mic" || kind === "system" ? deviceId() : null,
        mixMicDeviceId: kind === "mix" ? mixMicDeviceId() : null,
        mixSystemDeviceId: kind === "mix" ? mixSystemDeviceId() : null,
        targetPid: kind === "process" ? targetPid() : null,
        gain: gain(),
      },
      onChunk,
    });
  } catch (err) {
    setCaptureError(String(err));
    return false;
  }

  const channels = Math.max(1, info.channels);
  session = {
    kind,
    samples: new Float32Array(0),
    capacityFrames: 0,
    frames: 0,
    channels,
    sampleRate: info.sampleRate,
    peaks: new PeakAccumulator(channels, channelFor(channels)),
  };

  // Replay chunks that arrived before `start_capture` resolved.
  for (const chunk of pendingChunks) appendChunk(session, chunk);
  pendingChunks = [];
  setMonitoring(true);
  return true;
}

/**
 * Open (or reopen) the capture session so the input meter is live while idle.
 * Called when a live kind is selected; a no-op while recording.
 */
export async function startMonitor() {
  if (recording()) return;
  await haltSession();
  setCaptureError(null);
  await ensureSession();
}

/** Close the capture session (e.g. when switching to a file source). */
export async function stopMonitor() {
  if (recording()) return;
  await haltSession();
}

/** Start recording the configured live source into the timeline. */
export async function startCapture() {
  if (recording() || countdown() != null) return;
  const kind = choice();
  if (kind === "file" || kind === "synth") return;

  setCaptureError(null);
  setError(null);
  if (kind === "process" && targetPid() == null) {
    setCaptureError("Choose an application to capture.");
    return;
  }

  // Reuse a running monitoring session; otherwise open one now.
  if (!(await ensureSession())) return;

  const delay = Math.max(0, Math.floor(startDelay()));
  if (delay > 0) {
    const cancelled = await runCountdown(delay);
    if (cancelled) return;
  }

  const target = session;
  if (!target) return;
  // Fresh buffer: the recording starts now (monitored audio is not kept).
  target.samples = new Float32Array(INITIAL_FRAMES * target.channels);
  target.capacityFrames = INITIAL_FRAMES;
  target.frames = 0;
  target.peaks = new PeakAccumulator(target.channels, channelFor(target.channels));

  closeSource();
  // The core keeps its own copy of the recorded audio for preview (ADR-9).
  void invoke("begin_capture_source");
  follow = true;
  setRecording(true);
  setPaused(false);
  setElapsed(0);
  setStatus("capturing");
  publish(target, true);
  resetTimeline(0);
  if (!raf) raf = requestAnimationFrame(tick);
}

/**
 * Stop recording. The captured audio stays in the timeline, and the session keeps
 * running so the input meter stays live.
 */
export async function stopCapture() {
  if (!recording()) return;
  setRecording(false);
  setPaused(false);
  finishCountdown(false);

  const target = session;
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  if (target) {
    void invoke("end_capture_source");
    publish(target, false);
  }

  setStatus("ready");
}

/** Pause or resume chunk delivery while recording. */
export async function togglePause() {
  if (!recording()) return;
  const next = !paused();
  try {
    await invoke(next ? "pause_capture" : "resume_capture");
    setPaused(next);
  } catch (err) {
    setCaptureError(String(err));
  }
}

/** Set the live input gain; applied immediately to the running session. */
export async function applyGain(value: number) {
  setGainLevel(value);
  if (!session) return;
  try {
    await invoke("set_capture_gain", { gain: value });
  } catch (err) {
    setCaptureError(String(err));
  }
}
