import { fmtDb, formatHz } from "../format";
import type { AnalyzerDef } from "../types";

/** Perceptual (auditory-model) tools (Sidebar section `perception`). */
export const PERCEPTION_ANALYZERS: AnalyzerDef[] = [
  {
    id: "criticalBands",
    title: "Critical bands",
    description: "Bark or ERB critical-band energy over time",
    about:
      "**What it shows.** A time × band heatmap that integrates the spectrum into " +
      "critical bands — the bandwidths the ear resolves. Each row is one band, and " +
      "the y-axis labels its centre frequency in Hz.\n\n" +
      "**Why use it.** It groups energy the way hearing does, which makes the " +
      "distribution of energy across the spectrum easier to read than a dense " +
      "spectrogram. Choose the *Bark* scale (the Zwicker / MPEG convention) or the " +
      "*ERB* scale (used by the Moore–Glasberg loudness models). The shared FFT " +
      "size, hop, window, channel, and frequency range apply.",
    keywords: ["critical", "band", "bark", "erb", "psychoacoustic", "perception", "energy"],
    section: "perception",
    view: {
      kind: "matrix",
      yLabel: "band (Hz)",
      formatBand: formatHz,
      formatValue: fmtDb,
      bandAxisIsValue: true,
    },
    params: [
      {
        key: "scale",
        label: "Scale",
        kind: "select",
        value: 0,
        options: [
          { value: 0, label: "Bark" },
          { value: 1, label: "ERB" },
        ],
        title: "Critical-band scale — Bark (default) or ERB.",
      },
    ],
  },
];
