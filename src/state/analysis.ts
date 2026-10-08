import { createSignal } from "solid-js";
import type { ChannelPick } from "../lib/waveform";

/**
 * Shared analysis params (ADR-6): one frontend store the Timeline and every
 * analyzer tab read, so signal conditioning stays consistent across the app, and
 * every `run_analysis` call carries the same values. Per-tool params live in each
 * tool's own params popover, not here.
 *
 * See `docs/analysis-tools.md` → "Shared parameters" and `docs/data-model.md`.
 */

/**
 * Which channel of the source to analyse: `"mix"` downmixes every channel to
 * mono, a number selects a 0-based channel. See `docs/data-model.md`.
 */
export const [channel, setChannel] = createSignal<ChannelPick>("mix");

/** The pick clamped to a source's channel count (out-of-range falls back to the mix). */
export function channelFor(channels: number): ChannelPick {
  const pick = channel();
  return typeof pick === "number" && pick >= 0 && pick < channels ? pick : "mix";
}

export interface ChannelOption {
  value: ChannelPick;
  label: string;
}

/** Selector options for a source: downmix first, then one entry per channel. */
export function channelOptions(channels: number): ChannelOption[] {
  const options: ChannelOption[] = [{ value: "mix", label: "Downmix (mono)" }];
  for (let i = 0; i < channels; i++) {
    const label = channels === 2 ? (i === 0 ? "Left" : "Right") : `Channel ${i + 1}`;
    options.push({ value: i, label });
  }
  return options;
}

// --- frame analysis params -------------------------------------------------

/** FFT window sizes offered in the UI. */
export const FFT_SIZES = [512, 1024, 2048, 4096, 8192] as const;
export const [fftSize, setFftSize] = createSignal<number>(2048);

/** Hop as a fraction of the FFT window; 0.25 = 75% overlap. */
export const HOP_OPTIONS = [
  { value: 0.25, label: "75% overlap (hop ¼)" },
  { value: 0.5, label: "50% overlap (hop ½)" },
  { value: 0.75, label: "25% overlap (hop ¾)" },
  { value: 1, label: "No overlap (hop 1)" },
] as const;
export const [hop, setHop] = createSignal<number>(0.25);

/** Optional overlap randomization (break the fixed frame grid). */
export const [randomizedOverlap, setRandomizedOverlap] = createSignal(false);

/** Window function for spectral/pitch tools. */
export type WindowFn = "hann" | "hamming" | "blackman" | "rectangular";
export const WINDOW_FNS: { value: WindowFn; label: string }[] = [
  { value: "hann", label: "Hann" },
  { value: "hamming", label: "Hamming" },
  { value: "blackman", label: "Blackman" },
  { value: "rectangular", label: "Rectangular" },
];
export const [windowFn, setWindowFn] = createSignal<WindowFn>("hann");

/** Optional analysis sample rate (resample before analysis). `null` = source rate. */
export const ANALYSIS_RATES: { value: number | null; label: string }[] = [
  { value: null, label: "Source rate" },
  { value: 22_050, label: "22 050 Hz" },
  { value: 44_100, label: "44 100 Hz" },
  { value: 48_000, label: "48 000 Hz" },
];
export const [resampleTo, setResampleTo] = createSignal<number | null>(null);

/** Band limit for spectral/pitch tools, in Hz. `0` max means "up to Nyquist". */
export const [freqMinHz, setFreqMinHz] = createSignal(0);
export const [freqMaxHz, setFreqMaxHz] = createSignal(0);

/** The shared params as they cross the IPC boundary (camelCase, `docs/data-model.md`). */
export interface SharedParamsDto {
  fftSize: number;
  hop: number;
  randomizedOverlap: boolean;
  windowFn: WindowFn;
  /** 0-based channel index, or `null` to downmix. */
  channel: number | null;
  resampleTo: number | null;
  freqMinHz: number;
  freqMaxHz: number;
}

/** Snapshot the shared params for a `run_analysis` call. */
export function sharedParams(): SharedParamsDto {
  const pick = channel();
  return {
    fftSize: fftSize(),
    hop: hop(),
    randomizedOverlap: randomizedOverlap(),
    windowFn: windowFn(),
    channel: typeof pick === "number" ? pick : null,
    resampleTo: resampleTo(),
    freqMinHz: freqMinHz(),
    freqMaxHz: freqMaxHz(),
  };
}
