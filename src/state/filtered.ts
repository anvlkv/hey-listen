import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { pcmStream } from "../lib/pcmStream";
import { channel, channelArg, channelFor } from "./analysis";
import { filterActive, filterRevision } from "./graph";
import { source } from "./source";
import type { StreamSummary } from "../bindings/StreamSummary";

/**
 * The filtered (conditioned) mono PCM for the current source, streamed from the
 * core's `render_filtered` command and drawn as the Timeline overlay.
 *
 * The core conditions it exactly like preview/analysis (channel mixdown → filter)
 * at the **source** sample rate, so it lines up 1:1 with the raw waveform. This is
 * a read-only view: it never mutates the core source. It is cleared (`null`) while
 * no filter is applied (bypassed, or the graph is still the identity seed) or there is
 * no source.
 */

const [filteredSamples, setFilteredSamples] = createSignal<Float32Array | null>(null);

export { filteredSamples };

/** Debounce like the filter push, so a burst of edits triggers one render. */
const DEBOUNCE_MS = 250;
let timer: number | undefined;
/** Generation counter so a slow render can't clobber a newer one. */
let token = 0;

async function fetchFiltered() {
  const s = source();
  if (!s || !filterActive()) {
    setFilteredSamples(null);
    return;
  }
  const current = ++token;

  // Mirror the Timeline: downmix passes `null`, otherwise the clamped channel.
  const pick = channelFor(s.channels);
  const stream = pcmStream();
  try {
    await invoke<StreamSummary>("render_filtered", {
      channel: channelArg(pick),
      onChunk: stream.channel,
    });
    await stream.done;
    if (current !== token) return;
    setFilteredSamples(stream.samples());
  } catch {
    if (current !== token) return;
    setFilteredSamples(null);
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
