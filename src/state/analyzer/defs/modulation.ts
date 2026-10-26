import type { AnalyzerDef } from "../types";

/** AM/FM modulation spectra (M20). */
export const MODULATION_ANALYZERS: AnalyzerDef[] = [
  {
    id: "modulation",
    title: "AM/FM modulation",
    description: "Amplitude and pitch modulation rates, together",
    about:
      "**What it shows.** Two spectra over the same **modulation-rate** axis: the " +
      "*amplitude* envelope's spectrum (AM — tremolo, breathing, a pulse) and the " +
      "*pitch* track's residual spectrum in cents (FM — vibrato, a trill). A single " +
      "rate is not enough: slow breathing and a fast trill can coexist, and both peaks " +
      "appear here.\n\n" +
      "**Why use it.** Tell a fast amplitude flutter from a fast pitch trill, read " +
      "their rates and depths, and compare how strongly each is present. The readouts " +
      "give the top rate on each side, the AM depth and peak-to-trough range, and the " +
      "FM run's span and cents depth.\n\n" +
      "**How it works.** The AM spectrum comes from the frame-RMS envelope (linear " +
      "amplitude, detrended, Hann-windowed, zero-padded FFT). The FM spectrum comes " +
      "from the **longest voiced run**: range-limited YIN, converted to cents around " +
      "its median, then the same detrend and FFT. The analysable rate is clamped to " +
      "~45% of the slower analysis rate, so the effective range is reported rather " +
      "than silently aliased; the FM half is blank when no run is long enough. The FM " +
      "half also needs a *non-staircase* cents track: a run that visits only a few " +
      "quantized levels reports `fmReliable: 0` and no FM rate, instead of inventing a " +
      "vibrato. A steady run is reliable and simply reports no rate.",
    keywords: [
      "modulation",
      "am",
      "fm",
      "tremolo",
      "trill",
      "vibrato",
      "rate",
      "spectrum",
      "envelope",
      "bioacoustic",
      "breathing",
    ],
    section: "spectral",
    view: { kind: "modulation" },
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
        title: "RMS frame length for the amplitude envelope.",
      },
      {
        key: "hopMs",
        label: "Hop",
        kind: "number",
        value: 2.5,
        min: 0.5,
        max: 1000,
        step: 0.5,
        suffix: "ms",
        title:
          "Step between envelope frames. It also sets the highest usable AM rate (45% of 1/hop).",
      },
      {
        key: "modMinHz",
        label: "Min rate",
        kind: "number",
        value: 0.5,
        min: 0,
        max: 1000,
        step: 0.5,
        suffix: "Hz",
        title: "Bottom of the modulation-rate band.",
      },
      {
        key: "modMaxHz",
        label: "Max rate",
        kind: "number",
        value: 100,
        min: 1,
        max: 2000,
        step: 1,
        suffix: "Hz",
        title:
          "Top of the modulation-rate band. Clamped to ~45% of the analysis rate to avoid aliasing; the chart reports the range actually used.",
      },
      {
        key: "detrend",
        label: "Detrend",
        kind: "select",
        value: 1,
        options: [
          { value: 0, label: "Mean only" },
          { value: 1, label: "Linear" },
        ],
        title:
          "Remove the mean only, or a linear trend first (the default) so slow drift does not mask faster rates.",
      },
      {
        key: "pitchFrameMs",
        label: "Pitch frame",
        kind: "number",
        value: 40,
        min: 5,
        max: 500,
        step: 5,
        suffix: "ms",
        title:
          "Upper bound on the YIN window for the FM run; the window is capped at ~3 periods of the run's median f0 so fast modulation is not smeared.",
      },
      {
        key: "pitchHopMs",
        label: "Pitch hop",
        kind: "number",
        value: 5,
        min: 1,
        max: 100,
        step: 1,
        suffix: "ms",
        title: "Step between the FM run's pitch frames. It also sets the highest usable FM rate.",
      },
      {
        key: "minVoicedSecs",
        label: "Min voiced run",
        kind: "number",
        value: 0.2,
        min: 0,
        max: 60,
        step: 0.05,
        suffix: "s",
        title:
          "The shortest voiced run the FM half analyses; below this the FM spectrum and depths are blank.",
      },
      {
        key: "topPeaks",
        label: "Top peaks",
        kind: "number",
        value: 3,
        min: 1,
        max: 12,
        step: 1,
        title: "How many ranked rates each spectrum reports.",
      },
      {
        key: "minF0Hz",
        label: "Min f0",
        kind: "number",
        value: 50,
        min: 20,
        max: 5000,
        step: 5,
        suffix: "Hz",
        title: "Lowest expected fundamental for the FM track.",
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
        title: "Highest expected fundamental for the FM track.",
      },
    ],
  },
];
