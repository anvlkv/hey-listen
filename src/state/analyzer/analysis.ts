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
} from "../analysis";
import { filterRevision } from "../graph";
import { source, status } from "../source";
import { windowEnd, windowStart } from "../timeline";
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

  async function run() {
    const src = source();
    const start = windowStart();
    const end = windowEnd();
    if (!src || src.frames <= 0 || !(end > start)) {
      generation++;
      setResult(null);
      setError(null);
      setLoading(false);
      setLatestResult(tool, null);
      return;
    }

    const token = ++generation;
    setLoading(true);
    try {
      const response = await invoke<{ summary: unknown; result?: T }>("run_analysis", {
        request: { tool, start, end, params: sharedParams(), options: options(), shape: "full" },
      });
      if (token !== generation) return;
      const payload = response.result;
      if (payload == null) {
        setResult(null);
        setLatestResult(tool, null);
      } else {
        setResult(() => payload);
        setLatestResult(tool, payload as unknown as AnyAnalysisResult);
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
