import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
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
 * Analyzer tools (M4+, all oxiaudio tools in M5): the registry the Sidebar lists
 * and the Workbench mounts, plus the shared runner every analyzer tab uses.
 *
 * Analysis never runs on the UI thread (see `docs/architecture.md` → "Analysis
 * execution model"): a tab calls [`createAnalysis`], which watches the shared
 * params, its per-tool options, and the analysis window, and issues a **debounced**
 * `run_analysis` invoke (trailing ~200 ms), discarding stale responses
 * (latest-wins). Auto-run only happens while a tab is mounted, so closed tools are
 * never recomputed. See `docs/analysis-tools.md`.
 */

export type AnalyzerId =
  | "waveform"
  | "levels"
  | "spectrum"
  | "spectrogram"
  | "melSpectrogram"
  | "mfcc"
  | "chromagram"
  | "spectralCentroid"
  | "spectralFlux"
  | "spectralRolloff"
  | "spectralFlatness"
  | "spectralContrast"
  | "spectralBandwidth"
  | "spectralEntropy"
  | "spectralCrest"
  | "harmonicRatio"
  | "zeroCrossingRate"
  | "pitchPyin"
  | "pitchYin"
  | "pitchAutocorr"
  | "tempo"
  | "onsets"
  | "downbeats"
  | "loudnessIntegrated"
  | "loudnessMomentary"
  | "loudnessRange";

/** Grouping used by the Sidebar (mirrors `docs/analysis-tools.md`). */
export type AnalyzerSection = "time" | "spectral" | "pitch" | "rhythm" | "loudness";

export const ANALYZER_SECTIONS: { id: AnalyzerSection; title: string }[] = [
  { id: "time", title: "Time domain" },
  { id: "spectral", title: "Spectral" },
  { id: "pitch", title: "Pitch / melody" },
  { id: "rhythm", title: "Rhythm / tempo" },
  { id: "loudness", title: "Loudness" },
];

// --- view descriptors ------------------------------------------------------

/** A single-series line chart over time (or frequency). */
export interface SeriesView {
  kind: "series";
  yLabel: string;
  formatY: (value: number) => string;
  /** Draw dots as well as the line (sparse tracks such as pitch). */
  points?: boolean;
}

/** A frame × band heatmap. */
export interface MatrixView {
  kind: "matrix";
  yLabel: string;
  /** Label for a band row (bottom-up). */
  formatBand: (band: number) => string;
  formatValue: (value: number) => string;
}

export interface WaveformView {
  kind: "waveform";
}
export interface SpectrumView {
  kind: "spectrum";
}
export interface SpectrogramView {
  kind: "spectrogram";
}
export interface ReadoutsView {
  kind: "readouts";
}

/** Onset-strength envelope with event markers (rhythm tools). */
export interface RhythmView {
  kind: "rhythm";
  /** Which event sets to draw as markers on the envelope. */
  markers: ("beats" | "onsets" | "downbeats")[];
}

export type AnalyzerView =
  | SeriesView
  | MatrixView
  | WaveformView
  | SpectrumView
  | SpectrogramView
  | ReadoutsView
  | RhythmView;

/** A per-tool param rendered in the params popover (below the shared params). */
export interface ToolParamField {
  /** camelCase key as it crosses IPC (matches `audio/analysis.rs` → `ToolOptions`). */
  key: string;
  label: string;
  kind: "number" | "select";
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
  options?: { value: number; label: string }[];
}

/** Registry entry: how the tool is listed, titled, charted, and explained. */
export interface AnalyzerDef {
  id: AnalyzerId;
  title: string;
  description: string;
  /** "About" popover copy: when and how to use the tool. */
  about: string;
  /** Search terms for the Sidebar search box (`docs/analysis-tools.md`). */
  keywords: string[];
  section: AnalyzerSection;
  view: AnalyzerView;
  params?: ToolParamField[];
}

// --- formatting helpers ----------------------------------------------------

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz.toFixed(0)} Hz`;
}

const fmtDb = (value: number) => `${value.toFixed(1)} dB`;
const fmtRatio = (value: number) => `${(value * 100).toFixed(0)}%`;
const fmtPlain = (value: number) => value.toFixed(2);
const CHROMA_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function series(
  yLabel: string,
  formatY: (value: number) => string,
  points = false,
): SeriesView {
  return { kind: "series", yLabel, formatY, points };
}

const MEL_BANDS = [16, 24, 32, 48, 64, 96, 128].map((value) => ({
  value,
  label: `${value}`,
}));
const MFCC_COEFFS = [8, 13, 20, 26].map((value) => ({ value, label: `${value}` }));
const CONTRAST_BANDS = [4, 5, 6, 7, 8].map((value) => ({ value, label: `${value}` }));

// --- registry --------------------------------------------------------------

export const ANALYZERS: AnalyzerDef[] = [
  // Time domain
  {
    id: "waveform",
    title: "Waveform",
    description: "Time-domain shape with peak / RMS levels",
    about:
      "Shows the analysed signal as a min/max envelope over the window, with its " +
      "peak and RMS levels in dBFS (computed by oxiaudio). This is the conditioned " +
      "signal — channel selection, the filter graph, and any resample are applied — " +
      "so it reflects exactly what the other tools and preview playback see.",
    keywords: ["waveform", "time", "envelope", "amplitude", "peak", "rms", "oscilloscope"],
    section: "time",
    view: { kind: "waveform" },
  },
  {
    id: "levels",
    title: "Level meters",
    description: "Peak and RMS level over the window",
    about:
      "Peak and RMS levels of the conditioned signal, in linear amplitude and dBFS. " +
      "Use it as a quick loudness sanity check: it is the waveform tool without the " +
      "envelope, so it is cheap on long windows.",
    keywords: ["level", "meter", "peak", "rms", "dbfs", "loudness", "amplitude"],
    section: "time",
    view: { kind: "readouts" },
  },

  // Spectral
  {
    id: "spectrum",
    title: "Spectrum",
    description: "Averaged FFT magnitude vs frequency",
    about:
      "Averaged magnitude spectrum (STFT magnitudes averaged across the window's " +
      "frames), so steady tones stand out as peaks. Uses the shared FFT size, hop, " +
      "window function, channel, and frequency range. Drag-select to zoom; the " +
      "cursor readout gives the frequency and level under the pointer.",
    keywords: ["spectrum", "fft", "frequency", "magnitude", "welch", "harmonic"],
    section: "spectral",
    view: { kind: "spectrum" },
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
    keywords: ["spectrogram", "stft", "heatmap", "time", "frequency", "waterfall"],
    section: "spectral",
    view: { kind: "spectrogram" },
  },
  {
    id: "melSpectrogram",
    title: "Mel spectrogram",
    description: "Log-mel energies over time and mel bands",
    about:
      "A time × mel-band heatmap of log-mel energies. The mel scale spaces bands " +
      "perceptually (closer together at low frequencies), which makes it the usual " +
      "front end for speech and music ML. Uses the shared FFT size and hop; choose " +
      "the band count here.",
    keywords: ["mel", "spectrogram", "perceptual", "log", "speech", "machine learning"],
    section: "spectral",
    view: {
      kind: "matrix",
      yLabel: "mel band",
      formatBand: (band) => `mel ${band + 1}`,
      formatValue: (value) => value.toFixed(1),
    },
    params: [{ key: "nMels", label: "Mel bands", kind: "select", value: 64, options: MEL_BANDS }],
  },
  {
    id: "mfcc",
    title: "MFCC",
    description: "Mel-frequency cepstral coefficients over time",
    about:
      "Mel-frequency cepstral coefficients: a compact descriptor of the spectral " +
      "envelope (roughly timbre), one row per coefficient. The first coefficients " +
      "carry most of the energy. Derived from the same log-mel front end as the mel " +
      "spectrogram.",
    keywords: ["mfcc", "cepstral", "timbre", "coefficient", "speech", "feature"],
    section: "spectral",
    view: {
      kind: "matrix",
      yLabel: "coefficient",
      formatBand: (band) => `c${band}`,
      formatValue: (value) => value.toFixed(2),
    },
    params: [
      { key: "nMfcc", label: "Coefficients", kind: "select", value: 13, options: MFCC_COEFFS },
      { key: "nMels", label: "Mel bands", kind: "select", value: 64, options: MEL_BANDS },
    ],
  },
  {
    id: "chromagram",
    title: "Chromagram",
    description: "Energy per pitch class over time",
    about:
      "Energy in each of the twelve pitch classes (C…B) per frame — like a folded " +
      "spectrum. Useful for chords, key, and harmony: all octaves of a pitch land in " +
      "the same row.",
    keywords: ["chroma", "chromagram", "pitch class", "harmony", "chord", "key"],
    section: "spectral",
    view: {
      kind: "matrix",
      yLabel: "pitch class",
      formatBand: (band) => CHROMA_NOTES[band] ?? `#${band}`,
      formatValue: (value) => value.toFixed(3),
    },
  },
  {
    id: "spectralCentroid",
    title: "Spectral centroid",
    description: "Spectral centre of mass over time",
    about:
      "The frequency-weighted centre of mass of the spectrum per frame — a rough " +
      "brightness/timbre track. It rises with high-frequency content (e.g. cymbals, " +
      "fricatives) and falls for dark, low-frequency material.",
    keywords: ["centroid", "brightness", "timbre", "spectral", "center of mass"],
    section: "spectral",
    view: series("centroid (Hz)", formatHz),
  },
  {
    id: "spectralFlux",
    title: "Spectral flux",
    description: "Frame-to-frame spectral change (onset strength)",
    about:
      "The L2 norm of the half-wave-rectified change in magnitude between adjacent " +
      "frames — an onset-strength signal. Spikes mark note and drum attacks; it is " +
      "the basis of the onset and tempo detectors.",
    keywords: ["flux", "onset", "transient", "novelty", "spectral change"],
    section: "spectral",
    view: series("flux", fmtPlain),
  },
  {
    id: "spectralRolloff",
    title: "Spectral rolloff",
    description: "Frequency below which most energy lies",
    about:
      "The frequency under which a chosen share of the spectral energy is " +
      "concentrated (85% by default) — another brightness measure. Steadily low for " +
      "tonal/bassy signals, high for noise or bright material.",
    keywords: ["rolloff", "roll-off", "brightness", "energy", "high frequency"],
    section: "spectral",
    view: series("rolloff (Hz)", formatHz),
    params: [
      {
        key: "rolloffPercent",
        label: "Energy share",
        kind: "select",
        value: 0.85,
        options: [
          { value: 0.85, label: "85%" },
          { value: 0.95, label: "95%" },
          { value: 0.99, label: "99%" },
        ],
      },
    ],
  },
  {
    id: "spectralFlatness",
    title: "Spectral flatness",
    description: "Tonality vs noisiness over time",
    about:
      "The ratio of the geometric to the arithmetic mean of the power spectrum, in " +
      "0…1. Near 0 for a pure tone, near 1 for white noise — so it separates tonal " +
      "from noisy content.",
    keywords: ["flatness", "wiener", "entropy", "tonal", "noise", "tonality"],
    section: "spectral",
    view: series("flatness", fmtPlain),
  },
  {
    id: "spectralContrast",
    title: "Spectral contrast",
    description: "Peak-to-valley ratio per octave band",
    about:
      "For each octave-spaced band, the peak-to-valley ratio in dB. High contrast " +
      "means clear peaks over the band's noise floor (strong harmonics); low " +
      "contrast means a broadband, noisy band. Handy for distinguishing music from " +
      "speech and noise.",
    keywords: ["contrast", "peak", "valley", "octave", "band", "spectral"],
    section: "spectral",
    view: {
      kind: "matrix",
      yLabel: "octave band",
      formatBand: (band) => `band ${band + 1}`,
      formatValue: fmtDb,
    },
    params: [{ key: "nBands", label: "Bands", kind: "select", value: 6, options: CONTRAST_BANDS }],
  },
  {
    id: "spectralBandwidth",
    title: "Spectral bandwidth",
    description: "Spread around the spectral centroid",
    about:
      "The power-weighted standard deviation of the spectrum around its centroid, in " +
      "Hz — how spread out the energy is. Broad for noise and dense mixes, narrow " +
      "for a single tone.",
    keywords: ["bandwidth", "spread", "variance", "width", "spectral"],
    section: "spectral",
    view: series("bandwidth (Hz)", formatHz),
  },
  {
    id: "spectralEntropy",
    title: "Spectral entropy",
    description: "Order vs disorder of the spectrum",
    about:
      "Shannon entropy of the normalised power spectrum, in bits. Low for a pure " +
      "tone (energy in few bins), high for noise (energy spread across bins).",
    keywords: ["entropy", "shannon", "disorder", "noise", "spectral"],
    section: "spectral",
    view: series("entropy (bits)", fmtPlain),
  },
  {
    id: "spectralCrest",
    title: "Spectral crest factor",
    description: "Peak-to-average spectral power ratio",
    about:
      "The ratio of the maximum to the mean spectral power per frame. High for " +
      "peaky, tonal spectra (a pure sine is extreme); near 1 for a flat, noise-like " +
      "spectrum.",
    keywords: ["crest", "factor", "peak", "average", "tonal", "spectral"],
    section: "spectral",
    view: series("crest factor", fmtPlain),
  },
  {
    id: "harmonicRatio",
    title: "Harmonic ratio",
    description: "Harmonic (periodic) content over time",
    about:
      "An autocorrelation-based estimate of the harmonic-to-total ratio in 0…1 — how " +
      "periodic the frame is. Near 1 for sustained pitched tones, near 0 for noise " +
      "and unvoiced speech. Set the expected fundamental range below.",
    keywords: ["harmonic", "ratio", "hnr", "periodicity", "autocorrelation", "noise"],
    section: "spectral",
    view: series("harmonic ratio", fmtRatio),
    params: [
      { key: "minF0Hz", label: "Min f0", kind: "number", value: 60, min: 20, max: 2000, step: 5, suffix: "Hz" },
      { key: "maxF0Hz", label: "Max f0", kind: "number", value: 1200, min: 40, max: 5000, step: 50, suffix: "Hz" },
    ],
  },
  {
    id: "zeroCrossingRate",
    title: "Zero-crossing rate",
    description: "Sign-change rate over time",
    about:
      "The fraction of adjacent sample pairs that cross zero per frame. High for " +
      "noisy or high-frequency content, low for low-frequency tones. A classic " +
      "voiced/unvoiced and percussive/tonal cue.",
    keywords: ["zero crossing", "zcr", "sign", "voiced", "percussive", "rate"],
    section: "spectral",
    view: series("zero-crossing rate", fmtRatio),
  },

  // Pitch / melody
  {
    id: "pitchPyin",
    title: "Pitch (pYIN)",
    description: "Probabilistic YIN fundamental track",
    about:
      "Fundamental-frequency track from pYIN (probabilistic YIN with Viterbi " +
      "smoothing) — the most robust of the three pitch tools, and the default. " +
      "Unvoiced frames are left blank. Good for monophonic melody and speech.",
    keywords: ["pitch", "pyin", "f0", "fundamental", "melody", "viterbi"],
    section: "pitch",
    view: series("pitch (Hz)", formatHz, true),
  },
  {
    id: "pitchYin",
    title: "Pitch (YIN)",
    description: "YIN fundamental track",
    about:
      "Fundamental-frequency track from the YIN estimator (frame-by-frame, no " +
      "smoothing). Faster than pYIN and often similar on clean material, but more " +
      "prone to octave errors. Set the voiced/unvoiced threshold below.",
    keywords: ["pitch", "yin", "f0", "fundamental", "melody", "threshold"],
    section: "pitch",
    view: series("pitch (Hz)", formatHz, true),
    params: [
      { key: "yinThreshold", label: "YIN threshold", kind: "number", value: 0.12, min: 0.01, max: 0.9, step: 0.01 },
    ],
  },
  {
    id: "pitchAutocorr",
    title: "Pitch (autocorrelation)",
    description: "Autocorrelation fundamental track",
    about:
      "Fundamental-frequency track from FFT-based autocorrelation. Simple and cheap; " +
      "reliable on strongly periodic signals but sensitive to the assumed range. " +
      "Set the expected fundamental range below.",
    keywords: ["pitch", "autocorrelation", "acf", "f0", "fundamental", "period"],
    section: "pitch",
    view: series("pitch (Hz)", formatHz, true),
    params: [
      { key: "minF0Hz", label: "Min f0", kind: "number", value: 60, min: 20, max: 2000, step: 5, suffix: "Hz" },
      { key: "maxF0Hz", label: "Max f0", kind: "number", value: 1200, min: 40, max: 5000, step: 50, suffix: "Hz" },
    ],
  },

  // Rhythm / tempo
  {
    id: "tempo",
    title: "Tempo",
    description: "Estimated BPM and beat grid",
    about:
      "Estimates the tempo (BPM) from an onset-strength histogram and returns a " +
      "confidence and a beat grid. Works best on steady, percussive material; expect " +
      "octave errors (half/double time) on sparse or rubato input.",
    keywords: ["tempo", "bpm", "beat", "rhythm", "pulse", "detection"],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["beats"] },
  },
  {
    id: "onsets",
    title: "Onsets",
    description: "Detected note / event start times",
    about:
      "Detects onset times (in seconds) by spectral-flux peak picking. Useful for " +
      "finding attacks, transients, and note boundaries. Tune expectations with the " +
      "shared FFT size and hop.",
    keywords: ["onset", "attack", "transient", "event", "note", "detection"],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["onsets"] },
  },
  {
    id: "downbeats",
    title: "Downbeats",
    description: "Estimated bar-start beat times",
    about:
      "Estimates the tempo, then picks the beats likely to start a bar (downbeats) " +
      "using above-average bass energy. Set the beats-per-bar below (4 for 4/4). " +
      "Best on rhythmic music with a clear bass drum.",
    keywords: ["downbeat", "bar", "measure", "beat", "meter", "rhythm"],
    section: "rhythm",
    view: { kind: "rhythm", markers: ["beats", "downbeats"] },
    params: [
      {
        key: "barLength",
        label: "Beats per bar",
        kind: "select",
        value: 4,
        options: [2, 3, 4, 5, 6, 7].map((value) => ({ value, label: `${value}` })),
      },
    ],
  },

  // Loudness
  {
    id: "loudnessIntegrated",
    title: "Integrated LUFS",
    description: "EBU R128 integrated loudness",
    about:
      "Programme loudness integrated over the window, per EBU R128 / ITU-R BS.1770 " +
      "(with the gating the standard requires). This is the number streaming " +
      "platforms normalise to (typically −14 LUFS).",
    keywords: ["loudness", "lufs", "ebu", "r128", "integrated", "gating", "normalization"],
    section: "loudness",
    view: { kind: "readouts" },
  },
  {
    id: "loudnessMomentary",
    title: "Loudness (momentary)",
    description: "Short-term loudness over time",
    about:
      "Loudness as it evolves through the window. By default this is EBU R128 " +
      "momentary loudness (400 ms blocks, 100 ms hop); pick a custom window to use " +
      "non-overlapping blocks instead. Good for spotting level changes and dynamics.",
    keywords: ["loudness", "momentary", "short term", "lufs", "dynamics", "level"],
    section: "loudness",
    view: series("loudness (LUFS)", (value) => `${value.toFixed(1)} LUFS`),
    params: [
      {
        key: "windowMs",
        label: "Window",
        kind: "select",
        value: 0,
        options: [
          { value: 0, label: "EBU R128 (400 ms)" },
          { value: 100, label: "100 ms" },
          { value: 200, label: "200 ms" },
          { value: 500, label: "500 ms" },
          { value: 1000, label: "1000 ms" },
        ],
      },
    ],
  },
  {
    id: "loudnessRange",
    title: "Loudness range",
    description: "LRA — loudness spread in LU",
    about:
      "Loudness range (LRA): the spread between the quiet and loud passages of the " +
      "programme, in LU. A high LRA means wide dynamics; a low LRA means heavily " +
      "compressed, consistent material.",
    keywords: ["loudness", "range", "lra", "dynamics", "spread", "compression"],
    section: "loudness",
    view: { kind: "readouts" },
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

export function analyzersInSection(section: AnalyzerSection): AnalyzerDef[] {
  return ANALYZERS.filter((item) => item.section === section);
}

/** True if the tool matches the search query by title, description, or keyword. */
export function matchesQuery(def: AnalyzerDef, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [def.title, def.description, ...def.keywords].join(" ").toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
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

/** One scalar value per frame, over time; `null` entries are gaps. */
export interface SeriesResult {
  tool: AnalyzerId;
  sampleRate: number;
  hopSize: number;
  frames: number;
  times: number[];
  values: (number | null)[];
  minValue: number;
  maxValue: number;
}

/** A frame × band matrix, frame-major in `values`. */
export interface MatrixResult {
  tool: AnalyzerId;
  sampleRate: number;
  hopSize: number;
  frames: number;
  bins: number;
  duration: number;
  times: number[];
  bands: number[];
  values: number[];
  minValue: number;
  maxValue: number;
}

export interface LevelsResult {
  tool: "levels";
  sampleRate: number;
  frames: number;
  duration: number;
  peak: number;
  rms: number;
  peakDb: number;
  rmsDb: number;
}

/** Tempo / onset / downbeat analysis: an onset-strength envelope plus events. */
export interface RhythmResult {
  tool: "tempo" | "onsets" | "downbeats";
  bpm: number;
  confidence: number;
  hopSize: number;
  /** Frame times (seconds) of `onsetStrength`. */
  times: number[];
  /** Onset-strength envelope (one value per frame). */
  onsetStrength: number[];
  onsetTimes: number[];
  beatTimes: number[];
  downbeatTimes: number[];
}

export interface LufsResult {
  tool: "loudnessIntegrated";
  lufs: number;
}

export interface LraResult {
  tool: "loudnessRange";
  lra: number;
}

/** Any analyzer result returned over IPC. */
export type AnyAnalysisResult =
  | WaveformResult
  | SpectrumResult
  | SpectrogramResult
  | SeriesResult
  | MatrixResult
  | LevelsResult
  | RhythmResult
  | LufsResult
  | LraResult;

export interface AnalysisResultMap {
  waveform: WaveformResult;
  spectrum: SpectrumResult;
  spectrogram: SpectrogramResult;
  levels: LevelsResult;
  melSpectrogram: MatrixResult;
  mfcc: MatrixResult;
  chromagram: MatrixResult;
  spectralContrast: MatrixResult;
  spectralCentroid: SeriesResult;
  spectralFlux: SeriesResult;
  spectralRolloff: SeriesResult;
  spectralFlatness: SeriesResult;
  spectralBandwidth: SeriesResult;
  spectralEntropy: SeriesResult;
  spectralCrest: SeriesResult;
  harmonicRatio: SeriesResult;
  zeroCrossingRate: SeriesResult;
  pitchPyin: SeriesResult;
  pitchYin: SeriesResult;
  pitchAutocorr: SeriesResult;
  tempo: RhythmResult;
  onsets: RhythmResult;
  downbeats: RhythmResult;
  loudnessIntegrated: LufsResult;
  loudnessMomentary: SeriesResult;
  loudnessRange: LraResult;
}

// --- per-tool options ------------------------------------------------------

type ToolOptionsState = Record<string, Record<string, number>>;

function initialToolOptions(): ToolOptionsState {
  const state: ToolOptionsState = {};
  for (const def of ANALYZERS) {
    const values: Record<string, number> = {};
    for (const field of def.params ?? []) values[field.key] = field.value;
    state[def.id] = values;
  }
  return state;
}

/** Per-tool option values (not shared across tools), keyed by tool id then param. */
export const [toolOptions, setToolOptions] = createStore<ToolOptionsState>(initialToolOptions());

export function setToolOption(id: AnalyzerId, key: string, value: number) {
  setToolOptions(id, key, value);
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

  /** Snapshot the per-tool options; reading every key keeps this reactive. */
  const options = () => ({ ...toolOptions[tool] });

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
        request: { tool, start, end, params: sharedParams(), options: options() },
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
