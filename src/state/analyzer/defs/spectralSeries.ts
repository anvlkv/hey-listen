import { fmtDb, fmtPlain, fmtRatio, formatHz } from "../format";
import { series } from "../view";
import type { AnalyzerDef } from "../types";

/** Octave-band counts offered by the spectral-contrast tool. */
const CONTRAST_BANDS = [4, 5, 6, 7, 8].map((value) => ({ value, label: `${value}` }));

/** The scalar `spectral` tracks, charted as single series over time. */
export const SPECTRAL_SERIES_ANALYZERS: AnalyzerDef[] = [
  {
    id: "spectralCentroid",
    title: "Spectral centroid",
    description: "Brightness over time",
    about:
      "**What it shows.** Where the spectrum's energy sits on average — its *centre " +
      "of mass* — as a single frequency over time.\n\n" +
      "**Why use it.** A quick brightness and timbre track: it rises for cymbals, " +
      "fricatives, and bright mixes, and falls for bass and dark material. Useful " +
      "for comparing the tone of two takes.",
    keywords: ["centroid", "brightness", "timbre", "spectral", "center of mass"],
    section: "spectral",
    view: series("centroid (Hz)", formatHz, { style: "area", yScale: "log" }),
  },
  {
    id: "spectralFlux",
    title: "Spectral flux",
    description: "How much the spectrum changes moment to moment",
    about:
      "**What it shows.** How much the spectrum changes from one moment to the next; " +
      "spikes mark attacks.\n\n" +
      "**Why use it.** Reveals note and drum hits, and is the signal behind the " +
      "onset and tempo tools. A good way to see rhythm in the sound itself rather " +
      "than in the beat grid.",
    keywords: ["flux", "onset", "transient", "novelty", "spectral change"],
    section: "spectral",
    view: series("flux", fmtPlain, { style: "stems" }),
  },
  {
    id: "spectralRolloff",
    title: "Spectral rolloff",
    description: "Where most of the energy ends",
    about:
      "**What it shows.** The frequency below which a chosen share of the energy " +
      "lies — 85% by default.\n\n" +
      "**Why use it.** Another brightness measure: low and steady for bass-heavy or " +
      "tonal material, high for noise and bright mixes. Raise the share to reach " +
      "further into the high-frequency tail.",
    keywords: ["rolloff", "roll-off", "brightness", "energy", "high frequency"],
    section: "spectral",
    view: series("rolloff (Hz)", formatHz, { style: "area", yScale: "log" }),
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
        title:
          "Share of spectral energy below the rolloff frequency. 85% is the usual default; 95–99% reaches further into the high-frequency tail.",
      },
    ],
  },
  {
    id: "spectralFlatness",
    title: "Spectral flatness",
    description: "Tone versus noise",
    about:
      "**What it shows.** A score from 0 to 1: close to 0 for a clear tone, close to " +
      "1 for noise.\n\n" +
      "**Why use it.** Separates tonal from noisy stretches — useful for finding " +
      "hiss, breaths, cymbals, and pitched passages.",
    keywords: ["flatness", "wiener", "entropy", "tonal", "noise", "tonality"],
    section: "spectral",
    view: series("flatness", fmtPlain, { style: "area", yRange: [0, 1] }),
  },
  {
    id: "spectralContrast",
    title: "Spectral contrast",
    description: "Clear peaks versus broad noise, per octave",
    about:
      "**What it shows.** For each octave band, how far the strongest peak sits " +
      "above the band's noise floor, in dB.\n\n" +
      "**Why use it.** High values mean strong harmonics; low values mean a broad, " +
      "noisy band. Helps tell music from speech and noise.",
    keywords: ["contrast", "peak", "valley", "octave", "band", "spectral"],
    section: "spectral",
    view: {
      kind: "matrix",
      yLabel: "octave band",
      formatBand: (band) => `band ${band + 1}`,
      formatValue: fmtDb,
    },
    params: [
      {
        key: "nBands",
        label: "Bands",
        kind: "select",
        value: 6,
        options: CONTRAST_BANDS,
        title:
          "Number of octave-spaced bands compared (peak-to-valley each). More bands span a wider range.",
      },
    ],
  },
  {
    id: "spectralBandwidth",
    title: "Spectral bandwidth",
    description: "How spread out the energy is",
    about:
      "**What it shows.** The width of the spectrum around its centre of mass, in " +
      "Hz.\n\n" +
      "**Why use it.** Narrow for a single tone, wide for noise and dense mixes — a " +
      "simple gauge of how complex or full a sound is.",
    keywords: ["bandwidth", "spread", "variance", "width", "spectral"],
    section: "spectral",
    view: series("bandwidth (Hz)", formatHz, { style: "area", yScale: "log" }),
  },
  {
    id: "spectralEntropy",
    title: "Spectral entropy",
    description: "Order versus disorder in the spectrum",
    about:
      "**What it shows.** A disorder score: low when energy concentrates in a few " +
      "frequencies, high when it spreads across many.\n\n" +
      "**Why use it.** Separates clean tones and chords from noise and crowded " +
      "material. Read it alongside *flatness*.",
    keywords: ["entropy", "shannon", "disorder", "noise", "spectral"],
    section: "spectral",
    view: series("entropy (bits)", fmtPlain, { style: "area" }),
  },
  {
    id: "spectralCrest",
    title: "Spectral crest factor",
    description: "Peak versus average spectral power",
    about:
      "**What it shows.** How far the strongest frequency stands out from the " +
      "average, moment by moment.\n\n" +
      "**Why use it.** High for sharp, tonal spectra and near 1 for flat noise — " +
      "good for spotting tonal events inside a noisy bed.",
    keywords: ["crest", "factor", "peak", "average", "tonal", "spectral"],
    section: "spectral",
    view: series("crest factor", fmtPlain, { style: "stepped" }),
  },
  {
    id: "harmonicRatio",
    title: "Harmonic ratio",
    description: "How periodic the sound is",
    about:
      "**What it shows.** A 0–1 estimate of how much of the sound is *harmonic* " +
      "(periodic) rather than noise.\n\n" +
      "**Why use it.** Near 1 for sustained pitched notes and vowels, near 0 for " +
      "hiss, fricatives, and unvoiced speech. Set the expected fundamental range " +
      "below so the estimate stays useful.",
    keywords: ["harmonic", "ratio", "hnr", "periodicity", "autocorrelation", "noise"],
    section: "spectral",
    view: series("harmonic ratio", fmtRatio, { style: "area", yRange: [0, 1] }),
    params: [
      {
        key: "minF0Hz",
        label: "Min f0",
        kind: "number",
        value: 60,
        min: 20,
        max: 2000,
        step: 5,
        suffix: "Hz",
        title: "Lowest expected fundamental — the bottom of the autocorrelation search range.",
      },
      {
        key: "maxF0Hz",
        label: "Max f0",
        kind: "number",
        value: 1200,
        min: 40,
        max: 5000,
        step: 50,
        suffix: "Hz",
        title: "Highest expected fundamental — the top of the autocorrelation search range.",
      },
    ],
  },
  {
    id: "zeroCrossingRate",
    title: "Zero-crossing rate",
    description: "How often the waveform crosses zero",
    about:
      "**What it shows.** How often the signal changes sign, as a rate from 0 to 1.\n\n" +
      "**Why use it.** A classic cue for noisy or high-frequency content versus low " +
      "tones, and for voiced versus unvoiced speech. It also helps separate " +
      "percussive from tonal material.",
    keywords: ["zero crossing", "zcr", "sign", "voiced", "percussive", "rate"],
    section: "spectral",
    view: series("zero-crossing rate", fmtRatio, { style: "area", yRange: [0, 1] }),
  },
];
