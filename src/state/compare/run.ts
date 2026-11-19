import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { errorMessage, invoke } from "../../lib/ipc";
import { comparabilityNote, startRun, type RunLog } from "../../lib/runLog";
import { engineOptions, type AnalyzerId } from "../analyzer";
import {
  channel,
  fftSize,
  freqMaxHz,
  freqMinHz,
  hop,
  randomizedOverlap,
  resampleTo,
  sharedParams,
  windowFn,
} from "../analysis";
import { filterRevision } from "../graph";
import { source, status } from "../source";
import { windowEnd, windowStart } from "../timeline";
import type { CompareSetupDto, ComparisonDto, PeerSetupDto } from "./types";
import type { CompareBinding } from "./views";
import { setCompareFingerprint } from "./views";

/**
 * One comparison's compute (M25; saved references in M25.C).
 *
 * A's setup comes from this window's stores; B's from `compare_peer_setup` (a live
 * reference project) or from the core's **saved snapshot** (M25.C, no second window).
 * The request is debounced (~200 ms) and latest-wins, and re-runs when the peer's
 * revision changes — so a drag in either project settles into one comparison instead
 * of queuing one per pointer event. The UI asks for **full** arrays, because the
 * charts need them.
 */

/** Trailing debounce for a re-run, in ms. */
const DEBOUNCE_MS = 200;

/** How often the elapsed run time is republished to the view, in ms. */
const ELAPSED_TICK_MS = 500;

export interface CompareHandle {
  comparison: () => ComparisonDto | null;
  error: () => string | null;
  loading: () => boolean;
  /** Seconds since the current run started; `0` when nothing is running. */
  elapsed: () => number;
  /** Re-run now (bypassing the debounce). */
  refresh: () => void;
}

/** A reactive handle over one comparison: A × (live B | saved B) for `tool`. */
export function createComparison(
  tool: AnalyzerId,
  /** The comparison's stable id: the core upserts the matching pair's snapshot by it. */
  id: string,
  binding: () => CompareBinding | null,
  revision: () => number | null,
  /** The fine-tune offset δ: positive moves the reference later (M25.B). */
  bOffset: () => number = () => 0,
): CompareHandle {
  const [comparison, setComparison] = createSignal<ComparisonDto | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [elapsed, setElapsed] = createSignal(0);

  let generation = 0;
  let timer: number | undefined;
  /** The single elapsed-time ticker, alive only while a run is loading. */
  let clock: number | undefined;
  let clockStart = 0;
  /** The run whose log is still open, so a teardown closes it instead of letting it beat. */
  let activeLog: RunLog | null = null;

  function startClock() {
    clockStart = performance.now();
    setElapsed(0);
    if (clock === undefined) {
      clock = window.setInterval(
        () => setElapsed((performance.now() - clockStart) / 1000),
        ELAPSED_TICK_MS,
      );
    }
  }

  function stopClock() {
    if (clock !== undefined) {
      clearInterval(clock);
      clock = undefined;
    }
    setElapsed(0);
  }

  /** A's setup, read from this window's stores. */
  function setupA(): CompareSetupDto {
    return {
      start: windowStart(),
      end: windowEnd(),
      params: sharedParams(),
      options: engineOptions(tool),
    };
  }

  async function run() {
    const target = binding();
    if (!target) {
      generation++;
      setComparison(null);
      setError(null);
      setLoading(false);
      stopClock();
      return;
    }
    // A popout starts with an empty analysis window (0..0) until its shared timeline
    // arrives from the core; running here would fail with "the analysis window is
    // empty". Skip instead — `windowStart`/`windowEnd` are effect dependencies, so the
    // comparison runs again the moment the window is set.
    if (windowEnd() <= windowStart()) {
      return;
    }
    const token = ++generation;
    setLoading(true);
    startClock();
    let log: RunLog | null = null;
    try {
      const a = setupA();
      const request: Record<string, unknown> = {
        id,
        tool,
        a,
        bOffset: bOffset(),
        shape: "full",
      };
      if (target.kind === "saved") {
        request.saved = true;
      } else {
        // B's window/params/options and shape, from the reference project.
        const peer = await invoke<PeerSetupDto>("compare_peer_setup", {
          reference: target.reference,
          tool,
        });
        if (token !== generation) return;
        // The reference's analysis window is empty while its source/timeline is still
        // settling; `run_comparison` would fail with "the analysis window is empty", and
        // a settled revision would not re-run it. Skip instead — the revision poll
        // re-runs the comparison the moment the reference settles.
        if (peer.window.end <= peer.window.start) return;
        request.reference = target.reference;
        request.b = {
          start: peer.window.start,
          end: peer.window.end,
          params: peer.params,
          options: peer.options,
        };
      }
      // Only the compute is a run: the setup above may legitimately have nothing to do.
      const reference = target.kind === "saved" ? "saved reference" : target.reference;
      log = startRun("comparison", `${tool} vs ${reference}`);
      log.start();
      activeLog = log;
      const reply = await invoke<ComparisonDto>("run_comparison", { request });
      if (token !== generation) {
        log.finish("cancelled", "superseded");
        return;
      }
      setComparison(reply);
      setError(null);
      // The core recorded this result as the saved snapshot; its content fingerprint
      // is part of the project's dirty signature (M25.C).
      if (reply.savedFingerprint) setCompareFingerprint(tool, id, reply.savedFingerprint);
      const warning = comparabilityNote(
        reply.comparability.mismatches.length,
        reply.comparability.filtersDiffer,
      );
      if (warning) log.warn(warning);
      log.finish("ok");
    } catch (err) {
      if (token !== generation) {
        log?.finish("cancelled", "superseded");
        return;
      }
      setError(String(err));
      log?.finish("failed", errorMessage(err));
    } finally {
      if (activeLog === log) activeLog = null;
      if (token === generation) {
        setLoading(false);
        stopClock();
      }
    }
  }

  function schedule() {
    if (timer != undefined) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      void run();
    }, DEBOUNCE_MS);
  }

  createEffect(
    on(
      [
        source,
        status,
        windowStart,
        windowEnd,
        channel,
        fftSize,
        hop,
        randomizedOverlap,
        windowFn,
        resampleTo,
        freqMinHz,
        freqMaxHz,
        filterRevision,
        () => engineOptions(tool),
        binding,
        revision,
        bOffset,
      ],
      () => schedule(),
    ),
  );

  onCleanup(() => {
    generation++;
    if (timer != undefined) clearTimeout(timer);
    stopClock();
    // A comparison the core never answers cannot beat forever once the tab is gone.
    activeLog?.finish("cancelled", "closed");
    activeLog = null;
  });

  return { comparison, error, loading, elapsed, refresh: () => void run() };
}
