import type { AnalyzerDef } from "../types";

/** The `time` section of the registry (waveform, levels). */
export const TIME_ANALYZERS: AnalyzerDef[] = [
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
    description: "Peak and RMS level over the window",
    about:
      "Peak and RMS levels of the conditioned signal, in linear amplitude and dBFS. " +
      "Use it as a quick loudness sanity check: it is the waveform tool without the " +
      "envelope, so it is cheap on long windows.",
    keywords: ["level", "meter", "peak", "rms", "dbfs", "loudness", "amplitude"],
    section: "time",
    view: { kind: "readouts" },
  },
];
