import { series } from "../view";
import type { AnalyzerDef } from "../types";
import { GATE_PARAMS } from "./gate";

/** The calibrated perception models (sharpness/roughness/tonality/masking/spatial). */
export const PERCEPTION_MODEL_ANALYZERS: AnalyzerDef[] = [
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
      "1 acum. The panel under the chart decomposes each frame into per-band " +
      "contributions.\n\n" +
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
      // to that full-window distribution (the drill-down panel shows the per-band parts).
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
      ...GATE_PARAMS,
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
      "carrier reads about 0. The panels under the chart show the per-band " +
      "contribution and, for the cursor's frame, the band × rate grid.\n\n" +
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
      // AM/FM modulation spectra (the drill-down panel marks the weighted rate).
      supportingTool: "modulation",
      rateTarget: 70,
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
      ...GATE_PARAMS,
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
      "1 vacil; a steady carrier reads about 0. The panels under the chart show the " +
      "per-band contribution and, for the cursor's frame, the band × rate grid.\n\n" +
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
      // to the AM/FM modulation spectra (the drill-down panel marks the weighted rate).
      supportingTool: "modulation",
      rateTarget: 4,
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
      ...GATE_PARAMS,
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
