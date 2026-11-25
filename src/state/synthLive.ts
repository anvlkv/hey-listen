import { createEffect, createRoot, on, untrack } from "solid-js";
import { invoke } from "../lib/ipc";
import { toSpec } from "../lib/graph";
import { pcmStream } from "../lib/pcmStream";
import { recording, stopCapture } from "./capture";
import { SYNTH_GRAPH } from "./graph";
import { outputDeviceId } from "./output";
import { source, sourceRevision, currentSourceToken, nextSourceToken, status } from "./source";
import {
  applySynthSource,
  liveEnabled,
  rendering,
  setLiveEnabled,
  setLiveRendering,
  setSynthError,
  synthSeconds,
} from "./synth";
import { stop, transportStatus } from "../audio/preview";
import { synthEditorOpen } from "./workbench";
import {
  createSynthDebounce,
  liveRenderSeconds,
  liveTooLong,
  needsSynthConfirmation,
} from "../lib/synthPlan";
import type { StreamSummary } from "../bindings/StreamSummary";

/**
 * The synth **Live** scheduler (M22 / ADR-21).
 *
 * Every settled change to the synth graph or Length re-renders after a trailing
 * debounce (~160 ms, so a parameter drag produces a handful of renders, not one per
 * pointer move). Latest-wins: a newer settle makes an in-flight render stale in the
 * frontend **and** in the core's source gate.
 *
 * Live (`update_synth_source`) overwrites the synth source in place, so the analysis
 * follows the graph while the window, view, annotations and open tabs stay put. The
 * workflow only runs while the synth tab is open, and the toggle starts off. A failed
 * render leaves the last good source and reports inline — there is no *Source failed*
 * state.
 */

/** The one-shot/last render's command error is superseded: discard it silently. */
function isSuperseded(err: unknown): boolean {
  return String(err).includes("replaced before this render finished");
}

function graphSignature(): string {
  return JSON.stringify(toSpec(SYNTH_GRAPH.nodes, SYNTH_GRAPH.edges));
}

/** A source open/decode is in flight; a live render would race it, so wait. */
function sourceBusy(): boolean {
  const current = status();
  return current === "probing" || current === "decoding";
}

/** Run one settled render (the debounce's latest token). */
async function render(token: number) {
  if (!debounce.isCurrent(token) || !liveEnabled()) return;
  // A **Render** in flight already writes this graph at the Length field's value; a Live
  // pass now would supersede it (both claim a source token) for the same audio.
  if (rendering()) return;
  // A Live render must not change the timeline's length: over the cap it could only
  // truncate the source (and with it the saved project), so it is skipped and the tab
  // points at **Render**.
  if (liveTooLong(synthSeconds())) return;

  if (needsSynthConfirmation(source())) {
    const ok = await invoke<boolean>("confirm", {
      message: "Replacing the current source discards the existing audio.",
      title: "Replace source?",
    });
    if (!ok) {
      setLiveEnabled(false);
      return;
    }
  }
  if (!debounce.isCurrent(token)) return;

  if (recording()) await stopCapture();
  // A first adoption defines a new timeline: stop a source preview before the command,
  // so it cannot keep playing the previous source while the render runs.
  const firstAdoption = needsSynthConfirmation(source());
  if (firstAdoption && transportStatus() !== "idle") await stop();
  if (!debounce.isCurrent(token)) return;

  setSynthError(null);
  setLiveRendering(true);

  const spec = toSpec(SYNTH_GRAPH.nodes, SYNTH_GRAPH.edges);
  const requestId = nextSourceToken();
  const stream = pcmStream();

  try {
    const summary = await invoke<StreamSummary>("update_synth_source", {
      spec,
      seconds: liveRenderSeconds(synthSeconds()),
      sampleRate: 48_000,
      requestId,
      onChunk: stream.channel,
    });
    await stream.done;
    // The core has already installed this PCM. Only a newer **source replacement** makes
    // it stale: a superseded settle (a later edit, or Live turned off meanwhile) must
    // still be adopted, or the frontend would describe audio the core no longer holds.
    if (requestId !== currentSourceToken()) return;
    applySynthSource(stream.samples(), summary.sampleRate, summary.channels);
  } catch (err) {
    if (!debounce.isCurrent(token) || isSuperseded(err)) return;
    // Keep the last good source; the tab reports the failure inline.
    setSynthError(String(err));
  } finally {
    if (debounce.isCurrent(token)) setLiveRendering(false);
  }
}

const debounce = createSynthDebounce((token) => void render(token));

/** The last settled input set, so opening the tab does not re-render for nothing. */
let lastKey = "";

function settledKey(): string {
  return JSON.stringify([
    graphSignature(),
    synthSeconds(),
    liveEnabled(),
    outputDeviceId(),
    status(),
  ]);
}

/** Start the synth Live scheduler. Returns a disposer. */
export function initSynthLive(): () => void {
  return createRoot((dispose) => {
    createEffect(
      on(
        [
          synthEditorOpen,
          () => graphSignature(),
          synthSeconds,
          liveEnabled,
          outputDeviceId,
          status,
        ],
        () => {
          if (!synthEditorOpen()) {
            debounce.cancel();
            lastKey = "";
            return;
          }
          if (!liveEnabled()) {
            debounce.cancel();
            // Turning Live back on must render again, so drop the dedupe key rather than
            // treating the same graph as already done.
            lastKey = "";
            return;
          }
          if (sourceBusy()) return;
          const key = settledKey();
          if (key === lastKey) return;
          lastKey = key;
          debounce.schedule();
        },
        { defer: true },
      ),
    );

    // A wholesale source replacement (file, capture, project) hands the project to new
    // audio: never let Live overwrite it. A synth adoption carries `origin: "synth"` and
    // is this workflow's own write, so it is ignored.
    createEffect(
      on(
        sourceRevision,
        () => {
          const current = untrack(source);
          if (current?.origin === "synth") return;
          debounce.cancel();
          lastKey = "";
          if (current != null && untrack(liveEnabled)) setLiveEnabled(false);
        },
        { defer: true },
      ),
    );

    // A render error belongs to the graph that produced it: opening the synth tab or
    // changing its graph makes the message stale, so clear it rather than show a failure
    // against a graph the tab no longer holds (a spec or the user may have left one).
    createEffect(
      on(
        [synthEditorOpen, () => graphSignature()],
        () => {
          if (synthEditorOpen()) setSynthError(null);
        },
        { defer: true },
      ),
    );

    return dispose;
  });
}
