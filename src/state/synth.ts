import { invoke } from "../lib/ipc";
import { batch, createSignal } from "solid-js";
import { toSpec } from "../lib/graph";
import { loadBoolPref, saveBoolPref } from "../lib/prefStore";
import { pcmStream } from "../lib/pcmStream";
import { recording, setChoice, stopCapture } from "./capture";
import { SYNTH_GRAPH } from "./graph";
import { annotations, replaceAnnotations } from "./annotations";
import { clampViewRange } from "./timelineView";
import {
  currentSourceToken,
  finalizeSource,
  markKeepsTransport,
  nextSourceToken,
  setError,
  setSource,
  setStatus,
  source,
  type AudioSource,
} from "./source";
import {
  setView,
  setWindowEnd,
  setWindowStart,
  viewEnd,
  viewStart,
  windowEnd,
  windowStart,
} from "./timeline";
import { seek, stop } from "../audio/preview";
import type { StreamSummary } from "../bindings/StreamSummary";

/**
 * Synth rendering (ADR-21 / M22).
 *
 * - **Render once** ([`renderSynth`]) renders the whole graph; when the project source is
 *   already the synth it overwrites it **in place** (window/view/annotations stay), else
 *   it adopts a new timeline.
 * - **Live** ([`synthLive.ts`]) writes the source in place on each settled graph edit.
 *
 * The Live preference lives here (app-level, remembered like the Annotations rail) and
 * starts **off**, so opening the synth tab makes no sound unexpectedly.
 */

const LIVE_KEY = "hey-listen:synth-live";

/** Whether settled graph edits overwrite the synth source in place. */
export const [liveEnabled, setLiveEnabledSignal] = createSignal(loadBoolPref(LIVE_KEY));

/** Show or hide Live, persisting the choice. */
export function setLiveEnabled(enabled: boolean) {
  setLiveEnabledSignal(enabled);
  saveBoolPref(LIVE_KEY, enabled);
}

/** The rendered source length, in seconds (the tab's Length field). */
export const [synthSeconds, setSynthSeconds] = createSignal(4);

/** Render once in progress (disables the Render button). */
export const [rendering, setRendering] = createSignal(false);
/** The core's graph error, shown inline in the synth tab. */
export const [synthError, setSynthError] = createSignal<string | null>(null);
/** A Live render is in flight. */
export const [liveRendering, setLiveRendering] = createSignal(false);

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

/** Overwrite the current synth source **in place** (no timeline/window/history reset). */
function applyInPlace(samples: Float32Array, sampleRate: number, channels: number) {
  const current = source();
  if (!current) return;
  const ch = Math.max(1, channels);
  const frames = Math.floor(samples.length / ch);
  const duration = sampleRate > 0 ? frames / sampleRate : 0;
  const next: AudioSource = {
    ...current,
    samples,
    frames,
    sampleRate,
    channels: ch,
    duration,
    origin: "synth",
    live: false,
    peaks: undefined,
    peaksChannel: undefined,
  };
  // The core already installed this PCM (the command streamed the same render), so the
  // transport can reload in place instead of stopping (see `state/source.ts`).
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
 * Adopt a render. The first synth adoption defines a new timeline (resets the window and
 * view); later renders overwrite the source in place, so the window, view, annotations
 * and open analyzer tabs stay exactly where the user put them (ADR-21).
 */
export function applySynthSource(samples: Float32Array, sampleRate: number, channels: number) {
  if (source()?.origin === "synth") {
    applyInPlace(samples, sampleRate, channels);
    return;
  }
  finalizeSource({
    name: "Synth",
    detail: "fundsp synth",
    samples,
    sampleRate,
    channels,
    origin: "synth",
    keepsTransport: true,
  });
  // The saved project descriptor derives its kind from the picker, so the synth must be
  // the picker's choice too (and the Source panel stops monitoring capture inputs).
  setChoice("synth");
  // The synth owns the source now: reset the playhead.
  seek(0);
}

/** Render the current synth graph for `seconds` and load it as the source. */
export async function renderSynth(seconds: number, confirm = true) {
  if (rendering()) return;
  const current = source();
  const inPlace = current?.origin === "synth";

  // Only a *new* adoption discards audio, so an in-place re-render never asks again.
  // The MCP server can pass `confirm = false` when the agent explicitly replaces.
  if (confirm && current != null && !inPlace) {
    const ok = await invoke<boolean>("confirm", {
      message: "Replacing the current source discards the existing audio.",
      title: "Replace source?",
    });
    if (!ok) return;
  }

  setRendering(true);
  setSynthError(null);

  // Rendering replaces the source, so end any recording first.
  if (recording()) await stopCapture();

  if (!inPlace) {
    setError(null);
    setStatus("decoding");
    // A first adoption defines a new timeline; stop the transport so it cannot keep
    // playing the previous source while the render runs.
    await stop();
  }

  const spec = toSpec(SYNTH_GRAPH.nodes, SYNTH_GRAPH.edges);
  const stream = pcmStream();
  // Claim a source-replacement token, so a concurrent file open supersedes this render.
  const token = nextSourceToken();

  try {
    // `render_synth` is the one-shot/headless path; an existing synth source uses the
    // in-place command so the timeline and analysis window stay put.
    const summary = inPlace
      ? await invoke<StreamSummary>("update_synth_source", {
          spec,
          seconds,
          sampleRate: 48_000,
          requestId: token,
          onChunk: stream.channel,
        })
      : await invoke<StreamSummary>("render_synth", {
          spec,
          seconds,
          sampleRate: 48_000,
          requestId: token,
          onChunk: stream.channel,
        });
    await stream.done;
    if (token !== currentSourceToken()) return;

    applySynthSource(stream.samples(), summary.sampleRate, summary.channels);
  } catch (err) {
    // A rejected render is a *graph* error (shown in the synth tab): the previously
    // loaded source is untouched, so do not mark it as failed or disable the Timeline.
    setSynthError(String(err));
    if (!inPlace) setStatus(source() ? "ready" : "empty");
  } finally {
    setRendering(false);
  }
}
