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
    description: "Spectral centre of mass over time",
    about:
      "The frequency-weighted centre of mass of the spectrum per frame — a rough " +
      "brightness/timbre track. It rises with high-frequency content (e.g. cymbals, " +
      "fricatives) and falls for dark, low-frequency material.",
    keywords: ["centroid", "brightness", "timbre", "spectral", "center of mass"],
    section: "spectral",
    view: series("centroid (Hz)", formatHz, { style: "area", yScale: "log" }),
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
    view: series("flux", fmtPlain, { style: "stems" }),
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
    description: "Tonality vs noisiness over time",
    about:
      "The ratio of the geometric to the arithmetic mean of the power spectrum, in " +
      "0…1. Near 0 for a pure tone, near 1 for white noise — so it separates tonal " +
      "from noisy content.",
    keywords: ["flatness", "wiener", "entropy", "tonal", "noise", "tonality"],
    section: "spectral",
    view: series("flatness", fmtPlain, { style: "area", yRange: [0, 1] }),
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
    description: "Spread around the spectral centroid",
    about:
      "The power-weighted standard deviation of the spectrum around its centroid, in " +
      "Hz — how spread out the energy is. Broad for noise and dense mixes, narrow " +
      "for a single tone.",
    keywords: ["bandwidth", "spread", "variance", "width", "spectral"],
    section: "spectral",
    view: series("bandwidth (Hz)", formatHz, { style: "area", yScale: "log" }),
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
    view: series("entropy (bits)", fmtPlain, { style: "area" }),
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
    view: series("crest factor", fmtPlain, { style: "stepped" }),
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
    description: "Sign-change rate over time",
    about:
      "The fraction of adjacent sample pairs that cross zero per frame. High for " +
      "noisy or high-frequency content, low for low-frequency tones. A classic " +
      "voiced/unvoiced and percussive/tonal cue.",
    keywords: ["zero crossing", "zcr", "sign", "voiced", "percussive", "rate"],
    section: "spectral",
    view: series("zero-crossing rate", fmtRatio, { style: "area", yRange: [0, 1] }),
  },
];
