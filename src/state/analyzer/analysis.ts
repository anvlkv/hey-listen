/**
 * The shared analyzer runner: every analyzer tab runs through [`createAnalysis`].
 *
 * Analysis never runs on the UI thread (see `docs/architecture.md` → "Analysis
 * execution model"): a tab calls [`createAnalysis`], which watches the shared params,
 * its per-tool options, and the analysis window, and issues a **debounced**
 * `run_analysis` invoke (trailing ~200 ms), discarding stale responses
 * (latest-wins). The tabs request `shape: "full"` — precompaction is for the MCP/CLI
 * callers — and unwrap the command's `{ summary, result }` response. Auto-run only
 * happens while a tab is mounted, so closed tools are never recomputed. See
 * `docs/analysis-tools.md`.
 *
 * Every run first consults the [result cache](cache.ts): a result computed for the
 * same source, window, params and filter — or restored from the project file — is
 * adopted immediately, so reopening a project does not re-run every analyzer.
 */
import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { invoke } from "../../lib/ipc";
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
import { setLatestResult } from "./results";
import type { AnalyzerId, AnyAnalysisResult } from "./types";

/** Trailing debounce for auto-run, in ms (dragging coalesces). */
const DEBOUNCE_MS = 200;

export interface AnalysisHandle<T> {
  result: () => T | null;
  loading: () => boolean;
  error: () => string | null;
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

  /** Latest-wins token: a newer request invalidates any in-flight result. */
  let generation = 0;
  let timer: number | undefined;

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
    setError(null);
    setLoading(false);
  }

  async function run() {
    const request = inputs();
    if (!request) {
      generation++;
      setResult(null);
      setError(null);
      setLoading(false);
      setLatestResult(tool, null);
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
    setLoading(true);
    try {
      const response = await invoke<{ summary: unknown; result?: T }>("run_analysis", {
        request: {
          tool,
          start: request.start,
          end: request.end,
          params: request.params,
          options: request.options,
          shape: "full",
        },
      });
      if (token !== generation) return;
      const payload = response.result;
      if (payload == null) {
        setResult(null);
        setLatestResult(tool, null);
      } else {
        setResult(() => payload);
        setLatestResult(tool, payload as unknown as AnyAnalysisResult);
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
    } catch (err) {
      if (token !== generation) return;
      setError(String(err));
    } finally {
      if (token === generation) setLoading(false);
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
  });

  return { result, loading, error, run: () => void run() };
}
