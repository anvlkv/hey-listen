import { createSignal } from "solid-js";
import type { ChannelPick } from "../lib/waveform";
import type { SharedParams } from "../bindings/SharedParams";
import type { WindowKind } from "../bindings/WindowKind";

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

/** A channel pick as it crosses the IPC boundary: a 0-based index, or `null` to downmix. */
export function channelArg(pick: ChannelPick): number | null {
  return typeof pick === "number" ? pick : null;
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

/**
 * "When to use which" help per FFT size: the window length sets the frequency
 * resolution (rate ÷ size per bin) against the time resolution (size ÷ rate per
 * frame). Rendered as the FFT-size field tooltip.
 */
export const FFT_SIZE_HELP: Record<number, string> = {
  512: "Shortest window: fastest and best time resolution (good for transients), but coarse frequency bins — low notes and close partials blur together.",
  1024: "Finer frequency bins than 512 while staying responsive; a good fit for speech and percussive material.",
  2048: "Balanced default — a good compromise between frequency detail and time resolution.",
  4096: "Finer frequency detail; the longer window smooths fast transients. Best for sustained tones.",
  8192: "Finest frequency resolution; the longest window blurs transients. Best for steady low-frequency or harmonic content.",
};

/** Hop as a fraction of the FFT window; 0.25 = 75% overlap. */
export const HOP_OPTIONS = [
  {
    value: 0.25,
    label: "75% overlap (hop ¼)",
    help: "Most time detail and the smoothest spectrograms, at ~4× the compute. A good default.",
  },
  {
    value: 0.5,
    label: "50% overlap (hop ½)",
    help: "Balanced time resolution and compute — the usual STFT default.",
  },
  {
    value: 0.75,
    label: "25% overlap (hop ¾)",
    help: "Cheaper, coarser time resolution: fewer frames per second.",
  },
  {
    value: 1,
    label: "No overlap (hop 1)",
    help: "Fewest frames and cheapest; use when only averaged / long-term results matter.",
  },
] as const;
export const [hop, setHop] = createSignal<number>(0.25);

/** Optional overlap randomization (break the fixed frame grid). */
export const [randomizedOverlap, setRandomizedOverlap] = createSignal(false);

/** Window function for spectral/pitch tools (ts-rs binding). `help` explains when to pick each. */
export type WindowFn = WindowKind;
export const WINDOW_FNS: { value: WindowFn; label: string; help: string }[] = [
  {
    value: "hann",
    label: "Hann",
    help: "~4-bin main lobe with low side lobes (~−31 dB). The general-purpose default, especially with 50–75% overlap.",
  },
  {
    value: "hamming",
    label: "Hamming",
    help: "Similar main-lobe width to Hann but lower side lobes (~−43 dB); good when adjacent tones differ in level.",
  },
  {
    value: "blackman",
    label: "Blackman",
    help: "Widest main lobe (~6 bins) with very low side lobes (~−57 dB); use when strong tones would mask weak nearby components.",
  },
  {
    value: "rectangular",
    label: "Rectangular",
    help: "No taper: narrowest main lobe (best frequency resolution) but highest leakage (~−13 dB). Use for transients or whole-period frames.",
  },
];
export const [windowFn, setWindowFn] = createSignal<WindowFn>("hann");

/** Optional analysis sample rate (resample before analysis). `null` = source rate. */
export const ANALYSIS_RATES: { value: number | null; label: string; help: string }[] = [
  {
    value: null,
    label: "Source rate",
    help: "Analyse at the source's own rate — no resampling, no extra cost.",
  },
  {
    value: 22_050,
    label: "22 050 Hz",
    help: "Halve the rate: faster analysis with an 11 025 Hz Nyquist ceiling — fine for speech and voice-band work.",
  },
  {
    value: 44_100,
    label: "44 100 Hz",
    help: "Resample to the CD rate — useful for comparing sources recorded at different rates.",
  },
  {
    value: 48_000,
    label: "48 000 Hz",
    help: "Resample to 48 kHz — useful for comparing sources recorded at different rates.",
  },
];
export const [resampleTo, setResampleTo] = createSignal<number | null>(null);

/**
 * Band limit for **spectral** tools, in Hz. `0` max means "up to Nyquist". Pitch
 * tools have their own per-tool `minF0Hz` / `maxF0Hz` range instead.
 */
export const [freqMinHz, setFreqMinHz] = createSignal(0);
export const [freqMaxHz, setFreqMaxHz] = createSignal(0);

/** The shared params as they cross the IPC boundary (ts-rs binding, `docs/data-model.md`). */
export type SharedParamsDto = SharedParams;

/** Snapshot the shared params for a `run_analysis` call. */
export function sharedParams(): SharedParamsDto {
  const pick = channel();
  return {
    fftSize: fftSize(),
    hop: hop(),
    randomizedOverlap: randomizedOverlap(),
    windowFn: windowFn(),
    channel: channelArg(pick),
    resampleTo: resampleTo(),
    freqMinHz: freqMinHz(),
    freqMaxHz: freqMaxHz(),
  };
}

/** Restore the shared params from a saved project's setup. */
export function applySharedParams(shared: Partial<SharedParamsDto>) {
  if (shared.fftSize != null) setFftSize(shared.fftSize);
  if (shared.hop != null) setHop(shared.hop);
  if (shared.randomizedOverlap != null) setRandomizedOverlap(shared.randomizedOverlap);
  if (shared.windowFn != null) setWindowFn(shared.windowFn);
  if (shared.channel != null) setChannel(shared.channel);
  else setChannel("mix");
  if (shared.resampleTo != null) setResampleTo(shared.resampleTo);
  else setResampleTo(null);
  if (shared.freqMinHz != null) setFreqMinHz(shared.freqMinHz);
  if (shared.freqMaxHz != null) setFreqMaxHz(shared.freqMaxHz);
}

/** Reset the shared params to their defaults (New Project). */
export function resetAnalysisParams() {
  setChannel("mix");
  setFftSize(2048);
  setHop(0.25);
  setRandomizedOverlap(false);
  setWindowFn("hann");
  setResampleTo(null);
  setFreqMinHz(0);
  setFreqMaxHz(0);
}
