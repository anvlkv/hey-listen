import { formatHz } from "../format";
import { series } from "../view";
import type { AnalyzerDef } from "../types";

/** Fundamental-frequency estimators (Sidebar section `pitch`). */
export const PITCH_ANALYZERS: AnalyzerDef[] = [
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
    view: series("pitch (Hz)", formatHz, { points: true, yScale: "log", semitoneGrid: true }),
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
    view: series("pitch (Hz)", formatHz, { points: true, yScale: "log", semitoneGrid: true }),
    params: [
      {
        key: "yinThreshold",
        label: "YIN threshold",
        kind: "number",
        value: 0.12,
        min: 0.01,
        max: 0.9,
        step: 0.01,
        title:
          "Voiced/unvoiced threshold for YIN. Lower is stricter (fewer frames voiced); ~0.10–0.15 is typical.",
      },
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
    view: series("pitch (Hz)", formatHz, { points: true, yScale: "log", semitoneGrid: true }),
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
];
