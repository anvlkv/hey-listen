import { CHROMA_NOTES } from "../format";
import { EQ_LOUDNESS_PHONS } from "../../../lib/equalLoudness";
import type { AnalyzerDef } from "../types";

/** Mel band counts offered by the mel-spectrogram and MFCC tools. */
const MEL_BANDS = [16, 24, 32, 48, 64, 96, 128].map((value) => ({ value, label: `${value}` }));
/** Cepstral coefficient counts offered by the MFCC tool. */
const MFCC_COEFFS = [8, 13, 20, 26].map((value) => ({ value, label: `${value}` }));
/** Equal-loudness contour levels offered by the spectrum-style views. */
const PHON_LEVELS = [
  { value: 0, label: "Off" },
  ...EQ_LOUDNESS_PHONS.map((value) => ({ value, label: `${value} phon` })),
];

/**
 * The frame-based `spectral` tools: the heatmaps and the chromagram (the scalar
 * spectral tracks live in `./spectralSeries`).
 */
export const SPECTRAL_FRAME_ANALYZERS: AnalyzerDef[] = [
  {
    id: "spectrum",
    title: "Spectrum",
    description: "Average level at each frequency",
    about:
      "**What it shows.** The spectrum averaged over the window — level at each " +
      "frequency — so steady tones stand out as peaks.\n\n" +
      "**Why use it.** Find a signal's main frequencies, see where noise sits, or " +
      "compare takes. Drag-select to zoom, and hover for the frequency and level " +
      "under the pointer.\n\n" +
      "**Layers.** *Mean* is the average; *Min* and *Max* show the quietest and " +
      "loudest frame at each frequency. The shared FFT size, hop, window, channel, " +
      "and frequency range apply.\n\n" +
      "**Equal-loudness contour.** Choose a *phon* level to overlay a reference " +
      "curve of the level a pure tone needs at each frequency to sound equally " +
      "loud. The curve is in **dB SPL** while the spectrum is **dBFS**, so it is " +
      "drawn on its own right-hand axis and only lines up when the spectrum is " +
      "calibrated.",
    keywords: ["spectrum", "fft", "frequency", "magnitude", "welch", "harmonic"],
    section: "spectral",
    view: { kind: "spectrum" },
    params: [
      { key: "showMean", label: "Mean layer", kind: "toggle", value: 1, target: "view" },
      { key: "showMin", label: "Min layer", kind: "toggle", value: 1, target: "view" },
      { key: "showMax", label: "Max layer", kind: "toggle", value: 1, target: "view" },
      {
        key: "logFreq",
        label: "Log frequency",
        kind: "toggle",
        value: 1,
        target: "view",
        title: "Plot frequency on a logarithmic (octave) axis instead of linear.",
      },
      {
        key: "phonLevel",
        label: "Equal-loudness",
        kind: "select",
        value: 0,
        options: PHON_LEVELS,
        target: "view",
        title:
          "Overlay an equal-loudness contour reference at this phon level, in dB SPL. Off by default; it is only comparable when the spectrum is calibrated.",
      },
    ],
  },
  {
    id: "spectrogram",
    title: "Spectrogram",
    description: "Frequency content over time as a heatmap",
    about:
      "**What it shows.** Frequency up the side, time across, and colour for level " +
      "(dBFS).\n\n" +
      "**Why use it.** Follow how energy moves — transients, harmonics, and noise — " +
      "and see at a glance whether a sound is steady or changing. The shared FFT " +
      "settings apply; the per-tool control sets the displayed dynamic range.\n\n" +
      "**Contours.** *Centroid* and *Rolloff* can be drawn on top to trace the " +
      "spectrum's centre of mass and the frequency below which most energy lies.\n\n" +
      "**Equal-loudness contour.** Choose a *phon* level to read the reference level " +
      "a pure tone needs at the cursor's frequency (dB SPL). The heatmap itself is " +
      "dBFS, so the two scales are shown separately.",
    keywords: ["spectrogram", "stft", "heatmap", "time", "frequency", "waterfall"],
    section: "spectral",
    view: { kind: "spectrogram" },
    params: [
      {
        key: "showCentroid",
        label: "Centroid",
        kind: "toggle",
        value: 1,
        target: "view",
        title:
          "Overlay the spectral centroid (the spectrum's centre of mass) as a contour on the heatmap.",
      },
      {
        key: "showRolloff",
        label: "Rolloff",
        kind: "toggle",
        value: 1,
        target: "view",
        title:
          "Overlay the spectral rolloff frequency (85% of the energy lies below it) as a contour on the heatmap.",
      },
      {
        key: "phonLevel",
        label: "Equal-loudness",
        kind: "select",
        value: 0,
        options: PHON_LEVELS,
        target: "view",
        title:
          "Read the equal-loudness contour's reference level at the cursor's frequency, in dB SPL. Off by default.",
      },
    ],
  },
  {
    id: "melSpectrogram",
    title: "Mel spectrogram",
    description: "Energy in perceptually spaced bands over time",
    about:
      "**What it shows.** A time × band heatmap of log-mel energy, where bands are " +
      "spaced the way hearing is — closer together at low frequencies.\n\n" +
      "**Why use it.** It matches perception better than a plain spectrogram and is " +
      "the usual starting point for speech and music models. Choose the band count " +
      "here; the shared FFT size and hop apply.",
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
    description: "A compact timbre fingerprint over time",
    about:
      "**What it shows.** A few coefficients per moment that summarise the shape of " +
      "the spectrum — roughly, its *timbre*.\n\n" +
      "**Why use it.** It condenses a whole spectrum into a handful of numbers, " +
      "which makes sounds easy to compare and is a common feature for speech and " +
      "music models. The first coefficients carry most of the shape; add more for " +
      "finer detail.",
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
    description: "Energy per musical note over time",
    about:
      "**What it shows.** Twelve rows, one per pitch class (C through B), with every " +
      "octave of a note folded into the same row.\n\n" +
      "**Why use it.** Read chords, key, and harmony without wading through " +
      "harmonics. Tonal music shows clear rows; percussion and noise spread across " +
      "all of them.",
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
