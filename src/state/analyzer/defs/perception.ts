import { fmtDb, formatHz } from "../format";
import { series } from "../view";
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
  {
    id: "loudness",
    title: "Loudness (sone/phon)",
    description: "Perceived loudness — ISO 532-2 stationary sones over time",
    about:
      "**What it shows.** The perceived loudness of each analysis frame: `N` in " +
      "sones and `LN` in phons, from the stationary Moore–Glasberg model (the " +
      "ISO 532-2 family) on the ERB-rate axis. The summary reports the N5 (the " +
      "loudness exceeded 95% of the time), the mean and the maximum.\n\n" +
      "**Not EBU R128.** The *Integrated LUFS*, *Loudness (momentary)* and " +
      "*Loudness range* tools measure programme level in LUFS/LU. This tool " +
      "estimates how loud the sound *seems*, which is a different model and is " +
      "not numerically interchangeable.\n\n" +
      "**Calibration matters.** With *Calibration* at 0 the input is " +
      "**uncalibrated** and the sones are relative. Set it to the dB SPL of a " +
      "full-scale sine to read absolute sones and phons. This is a published " +
      "approximation, not an ISO conformance claim.",
    keywords: [
      "loudness",
      "sone",
      "sones",
      "phon",
      "phons",
      "perceived",
      "moore",
      "glasberg",
      "iso 532",
      "perception",
    ],
    section: "perception",
    view: { kind: "loudness" },
    params: [
      {
        key: "calibrationDbSpl",
        label: "Calibration",
        kind: "number",
        value: 0,
        min: 0,
        max: 140,
        step: 1,
        suffix: "dB SPL",
        title: "dB SPL of a full-scale sine; 0 = uncalibrated.",
      },
    ],
  },
  {
    id: "specificLoudness",
    title: "Specific loudness",
    description: "N'(z) specific-loudness map over ERB bands",
    about:
      "**What it shows.** A time × ERB-band heatmap of specific loudness `N'(z)`: " +
      "how much loudness each band contributes. The y-axis labels the band-centre " +
      "frequency in Hz; the intensity is in sone/Bark (linear, not dB).\n\n" +
      "**Why use it.** It shows *where* in the spectrum the perceived loudness " +
      "comes from — a bright, high-frequency sound has its specific loudness " +
      "pushed up in the upper rows, while a low rumble sits at the bottom. It is " +
      "the distribution the *Loudness (sone/phon)* tool integrates to a total, so " +
      "the two share the same model and calibration.\n\n" +
      "**Not EBU R128.** The LUFS tools measure programme level; this is the " +
      "Moore–Glasberg perceptual model. With *Calibration* at 0 the values are " +
      "relative (uncalibrated).",
    keywords: [
      "specific",
      "loudness",
      "sone",
      "bark",
      "erb",
      "map",
      "distribution",
      "moore",
      "glasberg",
      "perception",
    ],
    section: "perception",
    view: {
      kind: "matrix",
      yLabel: "ERB band (Hz)",
      formatBand: formatHz,
      formatValue: (value) => `${value.toFixed(3)} sone/Bark`,
      bandAxisIsValue: true,
    },
    params: [
      {
        key: "calibrationDbSpl",
        label: "Calibration",
        kind: "number",
        value: 0,
        min: 0,
        max: 140,
        step: 1,
        suffix: "dB SPL",
        title: "dB SPL of a full-scale sine; 0 = uncalibrated.",
      },
    ],
  },
  {
    id: "sharpness",
    title: "Sharpness",
    description:
      "Perceived sharpness — high-frequency emphasis of the specific-loudness distribution",
    about:
      "**What it shows.** Perceived sharpness per analysis frame, in acum, computed " +
      "from the specific-loudness distribution: the distribution is weighted toward " +
      "its high-frequency part, so a brighter sound scores higher than a dull, " +
      "low-frequency one at the same loudness. A 1 kHz reference tone reads about " +
      "1 acum.\n\n" +
      "**Why use it.** Sharpness separates a dull thud from a piercing, metallic or " +
      "hissy sound, which a physical brightness measure such as the spectral centroid " +
      "only approximates.\n\n" +
      "**Calibration matters.** With *Calibration* at 0 the input is **uncalibrated** " +
      "and the values are relative. Set it to the dB SPL of a full-scale sine to read " +
      "absolute acum, sharing the loudness model's calibration. This is a documented " +
      "approximation of the perceived quantity, not a conformance claim for any " +
      "standard.",
    keywords: ["sharpness", "brightness", "acum", "perception", "high frequency"],
    section: "perception",
    view: series("sharpness (acum)", (value) => value.toFixed(2) + " acum", {
      style: "area",
    }),
    params: [
      {
        key: "calibrationDbSpl",
        label: "Calibration",
        kind: "number",
        value: 0,
        min: 0,
        max: 140,
        step: 1,
        suffix: "dB SPL",
        title: "dB SPL of a full-scale sine; 0 = uncalibrated.",
      },
    ],
  },
];
