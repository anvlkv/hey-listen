import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { channel } from "./analysis";
import { pcmStream } from "../lib/pcmStream";
import { filterActive, filterRevision } from "./graph";
import { source } from "./source";
import type { StreamSummary } from "../bindings/StreamSummary";

/**
 * The filtered (conditioned) PCM for the current source, streamed from the core's
 * `render_filtered` command and drawn as the Timeline waveform.
 *
 * The core renders **every output channel** of the active filter graph (interleaved),
 * so a graph that splits the input into several branches shows one lane per branch.
 * It conditions the input exactly like preview/analysis (channel mixdown → filter) at
 * the **source** sample rate, so every frame lines up 1:1 with the raw waveform. This
 * is a read-only view: it never mutates the core source. It is cleared (`null`) while
 * no filter is applied (bypassed, or the graph is still the identity seed) or there is
 * no source.
 */

/** Interleaved filtered PCM plus the channel count the graph declared. */
export interface FilteredPcm {
  samples: Float32Array;
  /** One lane per filter output channel (always 1+). */
  channels: number;
}

const [filteredPcm, setFilteredPcm] = createSignal<FilteredPcm | null>(null);

export { filteredPcm };

/** Frames in the filtered buffer (a whole number of interleaved frames). */
export function filteredFrames(pcm: FilteredPcm): number {
  return Math.floor(pcm.samples.length / Math.max(1, pcm.channels));
}

/** Debounce like the filter push, so a burst of edits triggers one render. */
const DEBOUNCE_MS = 250;
let timer: number | undefined;
/** Generation counter so a slow render can't clobber a newer one. */
let token = 0;

async function fetchFiltered() {
  const s = source();
  if (!s || !filterActive()) {
    setFilteredPcm(null);
    return;
  }
  const current = ++token;

  // Mirror the analysis pick exactly. The pick mixes the source down (an out-of-range
  // index falls back to the downmix) before the graph reads it; every output channel is
  // rendered, so the Timeline can show all of them.
  const pick = channel();
  const stream = pcmStream();
  try {
    const summary = await invoke<StreamSummary>("render_filtered", {
      channel: typeof pick === "number" ? pick : null,
      onChunk: stream.channel,
    });
    await stream.done;
    if (current !== token) return;
    setFilteredPcm({
      samples: stream.samples(),
      channels: Math.max(1, summary.channels),
    });
  } catch {
    if (current !== token) return;
    setFilteredPcm(null);
  }
}

function scheduleFiltered() {
  if (timer != null) clearTimeout(timer);
  timer = window.setTimeout(() => void fetchFiltered(), DEBOUNCE_MS);
}

// Re-fetch whenever the source, the filter graph (revision), the enable toggle, or
// the channel changes, and once on startup.
createRoot(() => {
  createEffect(
    on(
      () => [source(), filterRevision(), filterActive(), channel()],
      () => scheduleFiltered(),
    ),
  );
});
