import { createEffect, createRoot, on } from "solid-js";
import type { ProbeInfo } from "../bindings/ProbeInfo";
import type { SourceWatchEvent } from "../bindings/SourceWatchEvent";
import type { StreamSummary } from "../bindings/StreamSummary";
import { invoke } from "../lib/ipc";
import { pcmStream } from "../lib/pcmStream";
import { listenThisWindow } from "../lib/windowEvents";
import { choice, recording } from "./capture";
import {
  applySourceInPlace,
  currentSourceToken,
  error,
  nextSourceToken,
  setError,
  source,
  status,
} from "./source";
import { sourceStorage, syncSourceWatch } from "./sourceStorage";

/**
 * Live-linked sources (the `liveLink` storage mode).
 *
 * The core watches the project's file (`syncSourceWatch`, see `state/sourceStorage.ts`)
 * and emits `source-changed` to **this** window when the file is rewritten or removed.
 * This module turns that event into a re-read: the file comes back through the same
 * `stream_file` command an open uses, and `applySourceInPlace` swaps the PCM under the
 * existing timeline, so the window, view, annotations and open tabs stay put.
 *
 * Only a settled file source stored as a live link reloads — a capture, a synth render,
 * a decode in flight and any other storage mode ignore the event with one log line.
 * Reloads are latest-wins and coalesced: a change that lands while a read is running
 * queues **one** more pass for the newest path, mirroring the in-flight/superseded rule
 * of `state/synthLive.ts`.
 */

/** Set by the disposer: a read that lands afterwards must leave the stores alone. */
let disposed = false;
/** The path the current re-read owns (`null` when idle). */
let running: string | null = null;
/** The newest path a change asked for while a read was running (one coalesced pass). */
let pendingRetry: string | null = null;
/** The last ignore line logged, so repeated events cannot flood the log. */
let lastIgnored = "";

/** A read a newer source replacement superseded: expected, so it is not an error. */
function isSuperseded(err: unknown): boolean {
  // The core's `DecodeError::Superseded` wording (`state/synthLive.ts` silences the
  // render's counterpart the same way).
  return String(err).includes("replaced before this");
}

/**
 * Why the timeline cannot take a re-read of `path` right now, or `null` when it can.
 *
 * One window is one source: only a live-linked **file** source reloads, and only while it
 * is settled — a capture is someone else's audio, a synth render is not a file, and an
 * open or decode in flight will install its own PCM when it finishes.
 */
function blocked(path: string): string | null {
  if (sourceStorage() !== "liveLink") return "the source is not a live link";
  if (choice() !== "file") return "the picker is not on a file";
  const loaded = source();
  if (loaded == null) return "there is no source";
  if (loaded.origin === "synth") return "the source is synthesized";
  if (recording()) return "a capture is recording";
  const busy = status();
  if (busy === "probing" || busy === "decoding") return `the source is ${busy}`;
  // The watcher follows one file, so an event for another path is not this timeline's.
  if (loaded.probe?.path !== path) return "the event names another file";
  return null;
}

/** One `console.info` per distinct reason: a watcher firing again must not spam the log. */
function logIgnored(path: string, reason: SourceWatchEvent["reason"], why: string) {
  const key = `${path}\n${reason}\n${why}`;
  if (key === lastIgnored) return;
  lastIgnored = key;
  console.info(`[source] ignoring a source-changed event for ${path} (${reason}): ${why}`);
}

/** Close a read's log without applying it: a newer replacement owns the timeline. */
function logCancelled(path: string) {
  console.info(`[source] linked file re-read cancelled (${path})`);
}

/**
 * `probe` with the fields a re-read can change taken from `summary`. It is the same file,
 * so the path, name, codec and bit depth stay as they were probed.
 */
export function applyProbe(
  probe: ProbeInfo | undefined,
  summary: StreamSummary,
): ProbeInfo | undefined {
  if (!probe) return undefined;
  return {
    ...probe,
    sampleRate: summary.sampleRate,
    channels: summary.channels,
    numFrames: summary.frames,
    durationSecs: summary.sampleRate > 0 ? summary.frames / summary.sampleRate : probe.durationSecs,
  };
}

/**
 * Re-read `path` once: stream it into the core (gated by the token, so a newer
 * replacement wins), then replace the PCM in place. A failure keeps the previous decode
 * and reports it; a missing file is handled before this is ever scheduled.
 */
async function reload(path: string): Promise<void> {
  const started = performance.now();
  console.info(`[source] re-reading the linked file (${path})`);
  const token = nextSourceToken();
  const stream = pcmStream();
  try {
    const summary = await invoke<StreamSummary>("stream_file", {
      path,
      requestId: token,
      onChunk: stream.channel,
    });
    await stream.done;
    if (disposed) return;
    // A newer replacement owns the timeline now: its audio must not be overwritten.
    if (token !== currentSourceToken()) {
      logCancelled(path);
      return;
    }
    applySourceInPlace({
      samples: stream.samples(),
      sampleRate: summary.sampleRate,
      channels: summary.channels,
      probe: applyProbe(source()?.probe, summary),
    });
    setError(null);
    const elapsed = Math.round(performance.now() - started);
    console.info(`[source] linked file re-read in ${elapsed} ms (${path})`);
  } catch (err) {
    if (disposed) return;
    if (isSuperseded(err)) {
      logCancelled(path);
      return;
    }
    // Keep the last good decode and report the failure on the toolbar's status line.
    setError(String(err));
    console.error(`[source] linked file re-read failed (${path})`, err);
  }
}

/**
 * The watched file is gone: keep the last decode (still the best copy of it there is)
 * and say so; the next `changed` event clears the message when the file returns.
 */
function reportMissing(path: string) {
  pendingRetry = null;
  const message = `the linked file is missing: ${path}`;
  // The watcher can repeat itself; the line is worth printing once per state.
  if (error() === message) return;
  setError(message);
  console.warn(`[source] linked file is missing (${path})`);
}

/** Run one read, then the single coalesced read a change queued while it was running. */
async function drain(first: string): Promise<void> {
  let path: string | null = first;
  try {
    while (path != null && !disposed) {
      pendingRetry = null;
      // The queued path may have stopped being the source (another file, a capture).
      const why = blocked(path);
      if (why == null) {
        await reload(path);
      } else {
        logIgnored(path, "changed", why);
      }
      path = pendingRetry;
    }
  } finally {
    running = null;
  }
}

/** Start a re-read, or remember it as the one pass to run when the current one settles. */
function schedule(path: string): void {
  if (running != null) {
    // Latest wins: two saves during one read need one more pass, not two.
    pendingRetry = path;
    return;
  }
  running = path;
  void drain(path);
}

/** Act on one watcher event: reload, report a missing file, or ignore with one line. */
function handle(event: SourceWatchEvent): void {
  const why = blocked(event.path);
  if (why != null) {
    logIgnored(event.path, event.reason, why);
    return;
  }
  // An accepted event re-arms the ignore line, so a later stop is logged again.
  lastIgnored = "";
  if (event.reason === "missing") {
    reportMissing(event.path);
  } else {
    schedule(event.path);
  }
}

/**
 * Subscribe to the core's live-link watcher. Call once per project window; the returned
 * disposer unlistens and drops a change that was waiting for the current read.
 */
export function initLiveLink(): () => void {
  disposed = false;
  const pending = listenThisWindow<SourceWatchEvent>("source-changed", (event) => {
    if (!disposed) handle(event.payload);
  }).catch((err: unknown) => {
    console.error("could not subscribe to source-changed", err);
    return null;
  });
  // A capture or a synth render can replace a file source without going through
  // `openPath`, so the watcher follows the picker and the mode as well: nothing may keep
  // watching a file that is no longer the source.
  const disposeWatch = createRoot((dispose) => {
    createEffect(on([choice, sourceStorage], () => void syncSourceWatch(), { defer: true }));
    return dispose;
  });
  return () => {
    disposed = true;
    pendingRetry = null;
    disposeWatch();
    void pending.then((unlisten) => unlisten?.());
  };
}
