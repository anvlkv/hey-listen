import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, on, onCleanup } from "solid-js";
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
} from "./analysis";
import { filterRevision } from "./graph";
import { source, status } from "./source";
import { windowEnd, windowStart } from "./timeline";

/**
 * Analyzer tools (M4): the registry the Sidebar lists and the Workbench mounts,
 * plus the shared runner every analyzer tab uses.
 *
 * Analysis never runs on the UI thread (see `docs/architecture.md` → "Analysis
 * execution model"): a tab calls [`createAnalysis`], which watches the shared
 * params + the analysis window and issues a **debounced** `run_analysis` invoke
 * (trailing ~200 ms), discarding stale responses (latest-wins). Auto-run only
 * happens while a tab is mounted, so closed tools are never recomputed.
 */

export type AnalyzerId = "waveform" | "spectrum" | "spectrogram";

/** Registry entry: how the tool is listed, titled, and explained. */
export interface AnalyzerDef {
  id: AnalyzerId;
  title: string;
  description: string;
  /** "About" popover copy: when and how to use the tool. */
  about: string;
}

export const ANALYZERS: AnalyzerDef[] = [
  {
    id: "waveform",
    title: "Waveform",
    description: "Time-domain shape with peak / RMS levels",
    about:
      "Shows the analysed signal as a min/max envelope over the window, with its " +
      "peak and RMS levels in dBFS (computed by oxiaudio). This is the conditioned " +
      "signal — channel selection, the filter graph, and any resample are applied — " +
      "so it reflects exactly what the other tools and preview playback see.",
  },
  {
    id: "spectrum",
    title: "Spectrum",
    description: "Averaged FFT magnitude vs frequency",
    about:
      "Averaged magnitude spectrum (STFT magnitudes averaged across the window's " +
      "frames), so steady tones stand out as peaks. Uses the shared FFT size, hop, " +
      "window function, channel, and frequency range. Drag-select to zoom; the " +
      "cursor readout gives the frequency and level under the pointer.",
  },
  {
    id: "spectrogram",
    title: "Spectrogram",
    description: "STFT magnitude heatmap over time and frequency",
    about:
      "A magnitude heatmap: frequency on the vertical axis, time on the horizontal, " +
      "and colour for level (dBFS). Good for seeing how energy moves over time — " +
      "transients, harmonics, and noise. Uses the shared STFT params; the per-tool " +
      "control sets the displayed dynamic range.",
  },
];

export function analyzerById(id: AnalyzerId): AnalyzerDef {
  const def = ANALYZERS.find((item) => item.id === id);
  if (!def) throw new Error(`unknown analyzer: ${id}`);
  return def;
}

export function isAnalyzerId(id: string): id is AnalyzerId {
  return ANALYZERS.some((item) => item.id === id);
}

// --- results (mirrors `audio/analysis.rs`) ---------------------------------

export interface WaveformResult {
  tool: "waveform";
  sampleRate: number;
  frames: number;
  duration: number;
  peak: number;
  rms: number;
  peakDb: number;
  rmsDb: number;
  min: number[];
  max: number[];
}

export interface SpectrumResult {
  tool: "spectrum";
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  frames: number;
  freqs: number[];
  magDb: number[];
  peakHz: number;
  peakDb: number;
}

export interface SpectrogramResult {
  tool: "spectrogram";
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  duration: number;
  frames: number;
  bins: number;
  freqs: number[];
  magDb: number[];
  minDb: number;
  maxDb: number;
}

export interface AnalysisResultMap {
  waveform: WaveformResult;
  spectrum: SpectrumResult;
  spectrogram: SpectrogramResult;
}

// --- runner ----------------------------------------------------------------

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
 * the source, analysis window, shared params, or filter change while mounted.
 */
export function createAnalysis<T>(tool: AnalyzerId): AnalysisHandle<T> {
  const [result, setResult] = createSignal<T | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  /** Latest-wins token: a newer request invalidates any in-flight result. */
  let generation = 0;
  let timer: number | undefined;

  async function run() {
    const src = source();
    const start = windowStart();
    const end = windowEnd();
    if (!src || src.frames <= 0 || !(end > start)) {
      generation++;
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    const token = ++generation;
    setLoading(true);
    try {
      const response = (await invoke<T>("run_analysis", {
        request: { tool, start, end, params: sharedParams() },
      })) as T;
      if (token !== generation) return;
      setResult(() => response);
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
