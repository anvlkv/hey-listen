import { formatHz } from "../format";
import { series } from "../view";
import type { AnalyzerDef } from "../types";

/** Fundamental-frequency estimators (Sidebar section `pitch`). */
export const PITCH_ANALYZERS: AnalyzerDef[] = [
  {
    id: "pitchPyin",
    title: "Pitch (pYIN)",
    description: "Robust pitch track — the default",
    about:
      "**What it shows.** The fundamental frequency (the perceived pitch) over time; " +
      "unvoiced moments are left blank.\n\n" +
      "**Why use it.** The most reliable of the three pitch tools and a good default " +
      "for monophonic melody or speech. Smoothing keeps it steadier and less prone " +
      "to octave jumps than plain YIN.\n\n" +
      "**Range.** pYIN searches a fixed **50–2000 Hz** window. Above 2 kHz use " +
      "*Pitch (YIN)* or *Pitch (autocorrelation)*, whose f0 range you can set in " +
      "their tool params.",
    keywords: ["pitch", "pyin", "f0", "fundamental", "melody", "viterbi"],
    section: "pitch",
    view: series("pitch (Hz)", formatHz, { points: true, yScale: "log", semitoneGrid: true }),
  },
  {
    id: "pitchYin",
    title: "Pitch (YIN)",
    description: "Fast pitch track, no smoothing",
    about:
      "**What it shows.** A pitch estimate for every moment, with no smoothing " +
      "between frames.\n\n" +
      "**Why use it.** Faster than pYIN and often similar on clean material, but it " +
      "can jump an octave. Adjust the f0 range and threshold below to trade " +
      "sensitivity for stability; this detector is not limited to 2 kHz.",
    keywords: ["pitch", "yin", "f0", "fundamental", "melody", "threshold"],
    section: "pitch",
    view: series("pitch (Hz)", formatHz, { points: true, yScale: "log", semitoneGrid: true }),
    params: [
      {
        key: "minF0Hz",
        label: "Min f0",
        kind: "number",
        value: 50,
        min: 20,
        max: 5000,
        step: 5,
        suffix: "Hz",
        title:
          "Lowest expected fundamental — the bottom of the YIN search range. Lower it for deep voices or animal calls.",
      },
      {
        key: "maxF0Hz",
        label: "Max f0",
        kind: "number",
        value: 2000,
        min: 40,
        max: 8000,
        step: 50,
        suffix: "Hz",
        title:
          "Highest expected fundamental — YIN can search above 2 kHz, unlike pYIN. Raise it for high calls or harmonics.",
      },
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
    description: "Simple pitch track for clear periodic sounds",
    about:
      "**What it shows.** The pitch found by comparing the signal with a delayed " +
      "copy of itself.\n\n" +
      "**Why use it.** Cheap and dependable on strongly periodic sounds, but " +
      "sensitive to the range you expect. Set that range below, and prefer pYIN on " +
      "noisy or changing material.",
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
