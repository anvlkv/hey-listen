import { series } from "../view";
import type { AnalyzerDef } from "../types";
import { GATE_PARAMS } from "./gate";

/** The `time` section of the registry (waveform, levels, amplitude envelope). */
export const TIME_ANALYZERS: AnalyzerDef[] = [
  {
    id: "waveform",
    title: "Waveform",
    description: "Signal shape with peak and RMS levels",
    about:
      "**What it shows.** The signal's shape over time — its outer envelope — with " +
      "the window's peak and RMS levels in dBFS.\n\n" +
      "**Why use it.** Spot clipping, silence, sudden level jumps, and transients at " +
      "a glance. It charts the *conditioned* signal (channel choice, filter, and any " +
      "resample applied), so it matches what playback and the other tools hear.",
    keywords: ["waveform", "time", "envelope", "amplitude", "peak", "rms", "oscilloscope"],
    section: "time",
    view: { kind: "waveform" },
    params: [
      {
        key: "dbScale",
        label: "dB scale",
        kind: "toggle",
        value: 0,
        target: "view",
        title: "Plot the envelope in dBFS (0 dBFS at the top) instead of linear amplitude.",
      },
    ],
  },
  {
    id: "levels",
    title: "Level meters",
    description: "Peak and RMS levels for the window",
    about:
      "**What it shows.** Peak and RMS levels of the conditioned signal, both as " +
      "linear amplitude and in dBFS.\n\n" +
      "**Why use it.** A quick check that audio is present, not clipping, and in a " +
      "sensible range. It is the waveform tool without the drawing, so it stays " +
      "fast on long windows.",
    keywords: ["level", "meter", "peak", "rms", "dbfs", "loudness", "amplitude"],
    section: "time",
    view: { kind: "readouts" },
  },
  {
    id: "frameRms",
    title: "Amplitude envelope",
    description: "Frame RMS level over time (dBFS)",
    about:
      "**What it shows.** The signal's amplitude envelope: the RMS level of short " +
      "consecutive frames, in dBFS.\n\n" +
      "**Why use it.** Follow loudness through a call or a phrase without EBU R128's " +
      "400 ms smoothing — useful for short notes, breaths, and level changes. Unlike " +
      "*Loudness (momentary)* it is a plain amplitude measure (no K-weighting), so it " +
      "agrees with the waveform's RMS. Set **Gate** to turn frames far below the window " +
      "peak into gaps (0 = off).",
    keywords: ["envelope", "amplitude", "rms", "dbfs", "level", "frame", "dynamics"],
    section: "time",
    view: series("level (dBFS)", (value) => `${value.toFixed(1)} dBFS`, { style: "area" }),
    params: [
      {
        key: "frameMs",
        label: "Frame",
        kind: "number",
        value: 10,
        min: 1,
        max: 1000,
        step: 1,
        suffix: "ms",
        title:
          "RMS window length — the envelope's smoothing. 10 ms resolves short notes; longer frames smooth the curve.",
      },
      {
        key: "hopMs",
        label: "Hop",
        kind: "number",
        value: 5,
        min: 1,
        max: 1000,
        step: 1,
        suffix: "ms",
        title: "Step between frames — smaller values give a denser envelope.",
      },
      ...GATE_PARAMS,
    ],
  },
];
