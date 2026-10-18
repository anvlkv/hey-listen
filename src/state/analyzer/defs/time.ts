import type { AnalyzerDef } from "../types";

/** The `time` section of the registry (waveform, levels). */
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
];
