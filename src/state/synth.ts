import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { toSpec } from "../lib/graph";
import { pcmStream } from "../lib/pcmStream";
import { recording, stopCapture } from "./capture";
import { SYNTH_GRAPH } from "./graph";
import { finalizeSource, setError, setStatus } from "./source";

/**
 * Synth rendering: build the fundsp net in the core, stream the rendered PCM back,
 * and adopt it as the project source (replacing the timeline).
 */

interface StreamSummary {
  sampleRate: number;
  channels: number;
  frames: number;
}

export const [rendering, setRendering] = createSignal(false);
export const [synthError, setSynthError] = createSignal<string | null>(null);

/** Render the current synth graph for `seconds` and load it as the source. */
export async function renderSynth(seconds: number) {
  if (rendering()) return;
  setRendering(true);
  setSynthError(null);
  setError(null);

  // Rendering replaces the timeline, so end any recording first.
  if (recording()) await stopCapture();

  setStatus("decoding");

  const spec = toSpec(SYNTH_GRAPH.nodes, SYNTH_GRAPH.edges);
  const stream = pcmStream();

  try {
    const summary = await invoke<StreamSummary>("render_synth", {
      spec,
      seconds,
      sampleRate: 48_000,
      onChunk: stream.channel,
    });
    await stream.done;

    finalizeSource({
      name: "Synth",
      detail: "fundsp synth",
      samples: stream.samples(),
      sampleRate: summary.sampleRate,
      channels: Math.max(1, summary.channels),
    });
  } catch (err) {
    setSynthError(String(err));
    setError(String(err));
    setStatus("error");
  } finally {
    setRendering(false);
  }
}
