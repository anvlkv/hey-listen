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
      // A perceived magnitude measured from a meaningful zero (no sharpness), so the
      // area from that baseline is the quantity itself.
      style: "area",
      sampling: "frame-centre",
      // Sharpness is the high-frequency-weighted integral of specific loudness; link
      // to that full-window distribution (per-frame contribution needs engine data).
      supportingTool: "specificLoudness",
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
  {
    id: "roughness",
    title: "Roughness",
    description: "Perceived roughness — band-envelope modulation near 70 Hz",
    about:
      "**What it shows.** Perceived roughness per analysis frame, in asper: the " +
      "harsh, buzzy quality of rapidly beating energy. The sound is split into " +
      "critical bands, each band's envelope is filtered near **70 Hz**, and the " +
      "result is weighted across bands and across frequency. A 1 kHz tone at " +
      "60 dB SPL, 100 % amplitude-modulated at 70 Hz, reads about 1 asper; a steady " +
      "carrier reads about 0.\n\n" +
      '**Why use it.** It separates a harsh, buzzy or rough sound — a rolled "r", ' +
      "distortion, a growl — from a smooth one with the same spectrum. Slow pulsing " +
      "belongs to *Fluctuation strength*, not here.\n\n" +
      "**Calibration matters.** With *Calibration* at 0 the input is " +
      "**uncalibrated** and the values are relative; set it to the dB SPL of a " +
      "full-scale sine to read absolute asper and to let quiet sound score lower. " +
      "This is a documented band-envelope model approximation of the perceived " +
      "quantity, not a conformance claim for any standard.",
    keywords: ["roughness", "asper", "harsh", "buzzy", "buzz", "perception"],
    section: "perception",
    view: series("roughness (asper)", (value) => value.toFixed(2) + " asper", {
      style: "area",
      sampling: "frame-centre",
      // Roughness is the ~70 Hz band-envelope modulation contribution; link to the
      // AM/FM modulation spectra (per-band/per-rate contribution needs engine data).
      supportingTool: "modulation",
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
  {
    id: "fluctuationStrength",
    title: "Fluctuation strength",
    description: "Perceived fluctuation strength — slow modulation near 4 Hz",
    about:
      "**What it shows.** Perceived fluctuation strength per analysis frame, in " +
      "vacil: the slow pulsing or wobble of a sound. It is the same band-envelope " +
      "model as *Roughness* with the modulation filter moved down to **4 Hz**. A " +
      "1 kHz tone at 60 dB SPL, 100 % amplitude-modulated at 4 Hz, reads about " +
      "1 vacil; a steady carrier reads about 0.\n\n" +
      "**Why use it.** It rates tremolo, rumbling machinery and distant " +
      "helicopters — fluctuations too slow to sound rough but fast enough to pulse. " +
      "Rapid beating belongs to *Roughness*.\n\n" +
      "**Calibration matters.** With *Calibration* at 0 the input is " +
      "**uncalibrated** and the values are relative; set it to the dB SPL of a " +
      "full-scale sine to read absolute vacil and to let quiet sound score lower. " +
      "This is a documented band-envelope model approximation of the perceived " +
      "quantity, not a conformance claim for any standard.",
    keywords: ["fluctuation", "vacil", "pulsing", "pulse", "am", "perception"],
    section: "perception",
    view: series("fluctuation (vacil)", (value) => value.toFixed(2) + " vacil", {
      style: "area",
      sampling: "frame-centre",
      // Fluctuation strength is the ~4 Hz band-envelope modulation contribution; link
      // to the AM/FM modulation spectra (per-band/per-rate contribution needs engine data).
      supportingTool: "modulation",
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
  {
    id: "masking",
    title: "Masking",
    description: "Masking threshold + signal-to-mask ratio over the spectrum",
    about:
      "**What it shows.** The averaged spectrum of the window with its **threshold " +
      "in quiet** `Tq(f)` and the **global masking threshold** `Tg(i)` overlaid, on a " +
      "level panel. `Tg` combines `Tq` with the contribution of every tonal and " +
      "non-tonal masker, spread over the Bark distance. Below it, a separate **SMR** " +
      "panel plots `SMR(i) = L(i) − Tg(i)` with a `0 dB` threshold rule and its own " +
      "y-axis; masked bins (`SMR < 0`) are also drawn as bands between the spectrum " +
      "and `Tg`.\n\n" +
      "**Why use it.** It answers which components are likely inaudible under their " +
      "neighbours — a quiet partial next to a loud one, or energy below the threshold " +
      "in quiet.\n\n" +
      "**Model and calibration.** This is the MPEG-style codec masking model, not a " +
      "universal predictor of human detection. `Tq` is always dB SPL: with " +
      "*Calibration* at 0 the spectrum is **uncalibrated** (dBFS) and the two scales " +
      "are mixed by construction, so set it to the dB SPL of a full-scale sine for an " +
      "absolute reading.",
    keywords: ["masking", "audibility", "smr", "threshold", "perception", "quiet"],
    section: "perception",
    view: { kind: "masking" },
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
    id: "tonality",
    title: "Tonality",
    description: "Tonal-energy ratio proxy over time",
    about:
      "**What it shows.** Per analysis frame, the share of the spectrum's power that " +
      "sits in **tonal** bins: `H = E_tonal / E_total` (0–1). Tonal bins are the local " +
      "maxima the *Masking* tool also treats as maskers, so the two share one detection " +
      "rule. A pure tone reads near 1; broadband noise reads near 0.\n\n" +
      '**A documented proxy, not a standard.** There is no single universal "tonality" ' +
      "number: the value depends entirely on how a tonal line is detected. This is a " +
      "simple, repeatable band-energy ratio, not a standardized perceptual metric and " +
      "not numerically interchangeable with one. Use it to compare a window against " +
      "another with the same settings.\n\n" +
      "**Calibration** only shifts every level by the same amount, so it does not change " +
      "the ratio; an uncalibrated run is still labelled as such for consistency with the " +
      "other perception tools.",
    keywords: ["tonality", "tonal", "ratio", "proxy", "perception", "noise"],
    section: "perception",
    view: series("tonality", (value) => (value * 100).toFixed(0) + "%", {
      yRange: [0, 1],
      sampling: "frame-centre",
      boundedMeaning: "share of the spectrum's power in tonal bins (0–1)",
      // Tonality is a ratio over the window spectrum's tonal bins; link to the
      // spectrum (a per-bin tonal-prominence spectrum needs engine data).
      supportingTool: "spectrum",
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
  {
    id: "spatial",
    title: "Spatial",
    description: "Mid/side levels and inter-channel correlation over time",
    about:
      "**What it shows.** The **normalized inter-channel correlation** `ρ_LR` per " +
      "analysis frame, plus the window's **mid** `(L + R) / 2` and **side** " +
      "`(L − R) / 2` RMS in dBFS. Correlation near 1 means the channels carry the " +
      "same signal (a centred, mono-like image); near 0 means they are unrelated " +
      "(wide, decorrelated stereo); negative values mean they move in opposition.\n\n" +
      "**Stereo only.** This tool reads the **left and right channels before** the " +
      "shared channel selector, so the *Channel* param does not apply and a mono " +
      "source returns no result. The filter still runs on each channel " +
      "independently.\n\n" +
      "**Acoustic cues, not a width model.** Mid/side energy and inter-channel " +
      "correlation describe stereo structure. Perceived width also depends on the " +
      "playback configuration and the listening room, so do not read ρ as a width " +
      "score.",
    keywords: ["spatial", "mid", "side", "correlation", "stereo", "width", "perception"],
    section: "perception",
    view: series("correlation", (value) => value.toFixed(2), {
      yRange: [-1, 1],
      sampling: "frame-centre",
      boundedMeaning:
        "normalized inter-channel correlation · −1 anti-phase, 0 unrelated, 1 identical",
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
