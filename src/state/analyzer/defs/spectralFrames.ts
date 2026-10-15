import { CHROMA_NOTES } from "../format";
import type { AnalyzerDef } from "../types";

/** Mel band counts offered by the mel-spectrogram and MFCC tools. */
const MEL_BANDS = [16, 24, 32, 48, 64, 96, 128].map((value) => ({ value, label: `${value}` }));
/** Cepstral coefficient counts offered by the MFCC tool. */
const MFCC_COEFFS = [8, 13, 20, 26].map((value) => ({ value, label: `${value}` }));

/**
 * The frame-based `spectral` tools: the heatmaps and the chromagram (the scalar
 * spectral tracks live in `./spectralSeries`).
 */
export const SPECTRAL_FRAME_ANALYZERS: AnalyzerDef[] = [
  {
    id: "spectrum",
    title: "Spectrum",
    description: "Averaged FFT magnitude vs frequency",
    about:
      "Averaged magnitude spectrum (STFT magnitudes averaged across the window's " +
      "frames), so steady tones stand out as peaks. Uses the shared FFT size, hop, " +
      "window function, channel, and frequency range. Drag-select to zoom; the " +
      "cursor readout gives the frequency and level under the pointer. The per-tool " +
      "switches overlay the per-frame min / max magnitude around the mean.",
    keywords: ["spectrum", "fft", "frequency", "magnitude", "welch", "harmonic"],
    section: "spectral",
    view: { kind: "spectrum" },
    params: [
      { key: "showMean", label: "Mean layer", kind: "toggle", value: 1 },
      { key: "showMin", label: "Min layer", kind: "toggle", value: 1 },
      { key: "showMax", label: "Max layer", kind: "toggle", value: 1 },
      {
        key: "logFreq",
        label: "Log frequency",
        kind: "toggle",
        value: 1,
        title: "Plot frequency on a logarithmic (octave) axis instead of linear.",
      },
    ],
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
    params: [
      {
        key: "showCentroid",
        label: "Centroid",
        kind: "toggle",
        value: 1,
        title:
          "Overlay the spectral centroid (the spectrum's centre of mass) as a contour on the heatmap.",
      },
      {
        key: "showRolloff",
        label: "Rolloff",
        kind: "toggle",
        value: 1,
        title:
          "Overlay the spectral rolloff frequency (85% of the energy lies below it) as a contour on the heatmap.",
      },
    ],
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
    params: [
      {
        key: "nMels",
        label: "Mel bands",
        kind: "select",
        value: 64,
        options: MEL_BANDS,
        title:
          "Number of mel bands. More bands give finer frequency detail; 64 is a common default.",
      },
    ],
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
      {
        key: "nMfcc",
        label: "Coefficients",
        kind: "select",
        value: 13,
        options: MFCC_COEFFS,
        title:
          "Cepstral coefficients (rows). ~13 captures the spectral envelope (timbre); more add finer detail.",
      },
      {
        key: "nMels",
        label: "Mel bands",
        kind: "select",
        value: 64,
        options: MEL_BANDS,
        title:
          "Mel bands fed to the cepstral transform. More bands give finer frequency detail before the DCT.",
      },
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
      noteGrid: true,
    },
  },
];
