/**
 * Web Audio preview playback for the Timeline.
 *
 * Preview is a frontend-only concern: the decoded PCM is already in the WebView
 * (streamed for the waveform), so a region can be auditioned without a round
 * trip to Rust. The `AudioBuffer` is built lazily on first use to keep source
 * loading snappy.
 *
 * Playback follows the Timeline's channel selection, so you hear what is drawn
 * (and, later, what is analysed).
 */

import type { ChannelPick } from "../lib/waveform";

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;

/** Source PCM, held so the `AudioBuffer` can be rebuilt per source. */
let samples: Float32Array | null = null;
let sampleRate = 44_100;
let channels = 1;
let pick: ChannelPick = "mix";
let buffer: AudioBuffer | null = null;

let active: AudioBufferSourceNode | null = null;
/** Bounds of the currently playing (looping) region, in seconds. */
let regionStart = 0;
let regionEnd = 0;
let startedAt = 0;

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function ensureContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(ctx.destination);
  }
  return ctx;
}

function ensureBuffer(): AudioBuffer | null {
  if (buffer) return buffer;
  if (!samples) return null;
  const ac = ensureContext();
  const frames = Math.floor(samples.length / channels);
  if (frames <= 0) return null;

  // Mono buffer: either the downmix or the selected channel.
  const buf = ac.createBuffer(1, frames, sampleRate);
  const plane = buf.getChannelData(0);
  const mixed = pick === "mix";
  const offset = mixed ? 0 : Math.min(Math.max(pick as number, 0), channels - 1);
  const inv = 1 / channels;

  for (let i = 0; i < frames; i++) {
    const base = i * channels;
    if (mixed) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += samples[base + c];
      plane[i] = sum * inv;
    } else {
      plane[i] = samples[base + offset];
    }
  }

  buffer = buf;
  return buf;
}

/** Follow the Timeline's channel selection (rebuilds the buffer on next play). */
export function setPreviewChannel(next: ChannelPick) {
  if (next === pick) return;
  pick = next;
  buffer = null;
}

/** Point the previewer at a new source (or `null` to clear it). */
export function setPreviewSource(
  nextSamples: Float32Array | null,
  nextRate: number,
  nextChannels: number,
) {
  stop();
  samples = nextSamples;
  sampleRate = nextRate;
  channels = nextChannels;
  buffer = null;
}

/**
 * Play `startSec..endSec`, optionally looping. Restarting while already playing
 * replaces the current region (used for drag preview).
 */
export function previewRegion(startSec: number, endSec: number, loop = true) {
  const buf = ensureBuffer();
  if (!buf) return;
  const ac = ensureContext();
  void ac.resume();

  stop();

  const dur = buf.duration;
  const start = clamp(startSec, 0, dur);
  const end = clamp(endSec, start + 1e-4, dur);

  const node = ac.createBufferSource();
  node.buffer = buf;
  node.loop = loop;
  node.loopStart = start;
  node.loopEnd = end;
  node.connect(gain!);
  node.start(0, start);

  regionStart = start;
  regionEnd = end;
  startedAt = ac.currentTime;
  active = node;
}

/** Stop any in-flight preview. */
export function stop() {
  if (active) {
    try {
      active.stop();
    } catch {
      // already stopped
    }
    active.disconnect();
    active = null;
  }
}

/** Current playback position (seconds) within the previewed region, if playing. */
export function playhead(): number | null {
  if (!active || !ctx) return null;
  const len = regionEnd - regionStart;
  if (len <= 0) return null;
  const elapsed = ctx.currentTime - startedAt;
  return regionStart + (elapsed % len);
}
