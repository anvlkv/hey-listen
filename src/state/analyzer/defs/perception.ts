import { fmtDb, fmtSone, formatHz } from "../format";
import type { AnalyzerDef } from "../types";
import { PERCEPTION_MODEL_ANALYZERS } from "./perceptionModels";

/** The band-model half of the perception tools (the models live in `perceptionModels`). */
const PERCEPTION_BASE_ANALYZERS: AnalyzerDef[] = [
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
      valueLabel: "band level",
      axisModel: "critical bands",
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
      "loudness exceeded 5% of the time — an upper-tail percentile), the mean and " +
      "the maximum.\n\n" +
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
    view: { kind: "loudness", yLabel: "loudness (sone)", formatY: fmtSone },
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
      "how much loudness each band contributes. The vertical axis is the ERB rate " +
      "(in Cam); each row is labelled by its band-centre frequency in Hz, and the " +
      "colourbar reports the intensity in sone/Cam (a linear density, shown on a " +
      "logarithmic colour scale).\n\n" +
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
      yLabel: "ERB rate (Cam)",
      formatBand: formatHz,
      formatValue: (value) => `${value.toFixed(3)} sone/Cam`,
      valueLabel: "specific loudness",
      axisModel: "ERB rate",
      bandAxisIsValue: true,
      // Sone/Cam density spans orders of magnitude from zero, so a linear ramp would
      // leave almost the whole map dark. `log1p` keeps 0 at the bottom of the ramp.
      colorTransform: "log1p",
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
];

/** Perceptual (auditory-model) tools (Sidebar section `perception`). */
export const PERCEPTION_ANALYZERS: AnalyzerDef[] = [
  ...PERCEPTION_BASE_ANALYZERS,
  ...PERCEPTION_MODEL_ANALYZERS,
];
