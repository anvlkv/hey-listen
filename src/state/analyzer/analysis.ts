/**
 * The shared analyzer runner: every analyzer tab runs through [`createAnalysis`].
 *
 * Analysis never runs on the UI thread
 * execution model"): a tab calls [`createAnalysis`], which watches the shared params,
 * its per-tool options, and the analysis window, and issues a **debounced**
 * `run_analysis` invoke (trailing ~200 ms), discarding stale responses
 * (latest-wins). The tabs request `shape: "full"` — precompaction is for the MCP/CLI
 * callers — and keep the command's `{ summary, result }` response: the result becomes the
 * tab's chart data, and the canonical summary is stored beside it for a later
 * annotation snapshot's structured items (D-19).
 *
 * Every run first consults the [result cache](cache.ts): a result computed for the
 * same source, window, params and filter — or restored from the project file — is
 * adopted immediately, so reopening a project does not re-run every analyzer.
 *
 * A live run also streams its **stages** back on a per-run `Channel` (D-21), and can be
 * stopped: a superseded, disappearing or user-cancelled run is cancelled iff it is still
 * in flight, and a cancelled run is not an error (the last good result stays).
 */
import { Channel } from "@tauri-apps/api/core";
import { createEffect, createSignal, on, onCleanup, untrack } from "solid-js";
import type { AnalysisPhase } from "../../bindings/AnalysisPhase";
import type { AnalysisProgress } from "../../bindings/AnalysisProgress";
import type { ResultSummary } from "../../bindings/ResultSummary";
import { errorMessage, invoke } from "../../lib/ipc";
import { hopWidenedNote, runSpanLabel, startRun, type RunLog } from "../../lib/runLog";
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
  type SharedParamsDto,
} from "../analysis";
import { filterRevision } from "../graph";
import { source, status } from "../source";
import { windowEnd, windowStart } from "../timeline";
import { cachedResult, resultCacheKey, storeResult, type CachedResult } from "./cache";
import { engineOptions } from "./options";
import { setLatestResult, setLatestSummary } from "./results";
import type { AnalyzerId, AnyAnalysisResult } from "./types";

/** Trailing debounce for auto-run, in ms (dragging coalesces). */
const DEBOUNCE_MS = 200;

/**
 * The transient run token the core echoes in every progress message and `cancel_analysis`
 * matches. It is a request token, not a domain id — `0` means "no cancellation".
 */
let nextRequestId = 1;

/** One in-flight run's streamed stage (D-21): the phase and how far it has got, 0…1. */
interface RunProgress {
  phase: AnalysisPhase;
  fraction: number;
}

export interface AnalysisHandle<T> {
  result: () => T | null;
  loading: () => boolean;
  error: () => string | null;
  /** The in-flight run's latest stage, or `null` when nothing is reporting (D-21). */
  progress: () => RunProgress | null;
  /** Stop the in-flight run at the core's next check; a finished run is never cancelled. */
  cancel: () => void;
  /** Re-run now (bypassing the debounce). */
  run: () => void;
}

/** The inputs one `run_analysis` call is made from, plus their cache key. */
interface RequestInputs {
  start: number;
  end: number;
  params: SharedParamsDto;
  options: Record<string, number>;
  key: string | null;
}

/**
 * Reactive handle over one analyzer tool's result. Auto-runs (debounced) whenever
 * the source, analysis window, shared params, per-tool options, or filter change
 * while mounted.
 */
export function createAnalysis<T>(tool: AnalyzerId): AnalysisHandle<T> {
  const [result, setResult] = createSignal<T | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<RunProgress | null>(null);

  /** Latest-wins token: a newer request invalidates any in-flight result. */
  let generation = 0;
  let timer: number | undefined;
  /** The token of the run still in flight, or `null` when there is nothing to cancel. */
  let inFlight: number | null = null;
  /** The run whose log is still open, so a teardown closes it instead of letting it beat. */
  let activeLog: RunLog | null = null;

  /**
   * Stop a run that is **still in flight**, and only that one: a finished run has already
   * released the id in its `finally`, and an adopted (cached) result never set one, so
   * both are no-ops here.
   */
  function cancelInFlight() {
    if (inFlight == null) return;
    const requestId = inFlight;
    inFlight = null;
    setProgress(null);
    void invoke("cancel_analysis", { requestId }).catch(() => undefined);
  }

  /**
   * Snapshot the engine-facing per-tool options. It reads the engine keys (so an
   * engine change re-runs) but not the display toggles, which only repaint the chart.
   */
  const options = () => engineOptions(tool);

  /** The request inputs for the current state, or `null` when there is nothing to run. */
  function inputs(): RequestInputs | null {
    const src = source();
    const start = windowStart();
    const end = windowEnd();
    if (!src || src.frames <= 0 || !(end > start)) return null;
    const params = sharedParams();
    const snapshot = options();
    return {
      start,
      end,
      params,
      options: snapshot,
      key: resultCacheKey({ tool, start, end, params, options: snapshot }),
    };
  }

  /** Adopt a cached result: no invoke, and any in-flight run is invalidated. */
  function adopt(cached: CachedResult) {
    generation++;
    if (timer != null) clearTimeout(timer);
    timer = undefined;
    setResult(() => cached.result as T);
    setLatestResult(tool, cached.result);
    // The cache (and the project file's `RESULTS` section) keeps the result alone, so a
    // cached entry must never be paired with a summary from an earlier live run.
    setLatestSummary(tool, null);
    setError(null);
    setLoading(false);
  }

  async function run() {
    // A newer run supersedes whatever is still in flight (D-21): stop it before starting.
    cancelInFlight();
    const request = inputs();
    if (!request) {
      generation++;
      setResult(null);
      setError(null);
      setLoading(false);
      setLatestResult(tool, null);
      setLatestSummary(tool, null);
      return;
    }

    // A result for exactly these inputs (computed earlier, or seeded from the project
    // file) is adopted instead of re-running the analyzer.
    const cached = cachedResult(request.key);
    if (cached) {
      adopt(cached);
      return;
    }

    const token = ++generation;
    const requestId = nextRequestId++;
    inFlight = requestId;
    const log = startRun(
      "analysis",
      `${tool} ${runSpanLabel(request.start, request.end)}`,
      () => untrack(progress)?.phase ?? null,
    );
    log.start();
    activeLog = log;
    // One channel per run: a message is applied only when it carries this run's token, so
    // a stale channel (an older run still finishing) cannot overwrite the current stage.
    const onProgress = new Channel<AnalysisProgress>();
    onProgress.onmessage = (message) => {
      if (message.requestId !== requestId) return;
      setProgress({ phase: message.phase, fraction: message.fraction });
    };
    setProgress(null);
    setLoading(true);
    try {
      const response = await invoke<{
        summary: ResultSummary;
        result?: T;
        hopWidenedFromSamples?: number;
      }>("run_analysis", {
        request: {
          tool,
          start: request.start,
          end: request.end,
          params: request.params,
          options: request.options,
          shape: "full",
          requestId,
        },
        onProgress,
      });
      if (token !== generation) {
        log.finish("cancelled", "superseded");
        return;
      }
      const payload = response.result;
      if (payload == null) {
        setResult(null);
        setLatestResult(tool, null);
        setLatestSummary(tool, null);
      } else {
        setResult(() => payload);
        setLatestResult(tool, payload as unknown as AnyAnalysisResult);
        setLatestSummary(tool, response.summary);
        if (request.key != null) {
          storeResult(
            {
              tool,
              start: request.start,
              end: request.end,
              params: request.params,
              options: request.options,
              result: payload as unknown as AnyAnalysisResult,
            },
            request.key,
          );
        }
      }
      setError(null);
      if (response.hopWidenedFromSamples != null) {
        log.warn(hopWidenedNote(response.hopWidenedFromSamples));
      }
      log.finish("ok");
    } catch (err) {
      // A superseded/disappearing/user-stopped run is not a failure: keep the last good
      // result and leave the error signal alone.
      if (token !== generation || errorMessage(err) === "cancelled") {
        log.finish("cancelled", token !== generation ? "superseded" : undefined);
        return;
      }
      setError(String(err));
      log.finish("failed", errorMessage(err));
    } finally {
      // Release the slot only if this run still owns it (a newer run may have taken it).
      if (inFlight === requestId) inFlight = null;
      if (activeLog === log) activeLog = null;
      if (token === generation) {
        setProgress(null);
        setLoading(false);
      }
    }
  }

  function schedule() {
    if (timer != null) clearTimeout(timer);
    timer = undefined;
    // A known result is adopted immediately; only a cache miss waits for the debounce.
    if (cachedResult(inputs()?.key ?? null)) {
      void run();
      return;
    }
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
        options,
      ],
      () => schedule(),
    ),
  );

  onCleanup(() => {
    generation++;
    if (timer != null) clearTimeout(timer);
    cancelInFlight();
    // A run the core never answers cannot beat forever once the tab is gone.
    activeLog?.finish("cancelled", "closed");
    activeLog = null;
  });

  return {
    result,
    loading,
    error,
    progress,
    cancel: cancelInFlight,
    run: () => void run(),
  };
}
