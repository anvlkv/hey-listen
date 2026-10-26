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
  {
    id: "noteMetrics",
    title: "Note segments",
    description: "Detected note spans, gaps, levels, and voice-quality proxies",
    about:
      "**What it shows.** The audio's **note segments**: each run above an amplitude " +
      "gate with its start, end, duration, the silence before and after, its RMS and " +
      "peak level, and a short normalized envelope. Summary cards give the note / gap " +
      "counts and the median durations; the table lists every note.\n\n" +
      "**Why use it.** Count calls or syllables, measure how long the gaps are, and " +
      "compare levels between notes without reading an envelope by eye. The gate is " +
      "`max(gate floor, window peak − gate)` with hysteresis, so quiet background " +
      "noise does not split a note. Pair it with **Amplitude envelope** (`frameRms`) " +
      "to see what the gate sees; *Loudness (momentary)* is a 400 ms R128 block and " +
      "smears short calls.\n\n" +
      "**Voice-quality proxies (per note).** *Jitter* is the spread of the note's " +
      "linearly detrended YIN f0 track in cents; *shimmer* is the spread of its " +
      "frame RMS in dB; *HNR* is the mean 0–1 autocorrelation periodicity " +
      "(`harmonic_ratio`), not HNR in dB. They are **proxies**, not clinical " +
      "measures, and stay blank when a note is too short or too unvoiced to measure.\n\n" +
      "**Not annotations.** These are **detected audio notes**, not the project's " +
      "user-authored annotations (the right-hand rail's markdown notes).",
    keywords: [
      "note",
      "notes",
      "segment",
      "syllable",
      "gap",
      "duration",
      "level",
      "call",
      "bioacoustic",
      "jitter",
      "shimmer",
      "hnr",
      "voice quality",
      "periodicity",
    ],
    section: "pitch",
    view: { kind: "noteMetrics" },
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
        title: "RMS frame length — the segmentation's time smoothing.",
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
        title: "Step between frames; smaller values resolve shorter notes.",
      },
      {
        key: "gateDb",
        label: "Gate",
        kind: "number",
        value: 35,
        min: 0,
        max: 120,
        step: 1,
        suffix: "dB",
        title: "How far below the window's loudest frame a note must rise.",
      },
      {
        key: "gateFloorDb",
        label: "Gate floor",
        kind: "number",
        value: -60,
        min: -120,
        max: 0,
        step: 1,
        suffix: "dBFS",
        title: "Absolute floor; anything quieter is never a note.",
      },
      {
        key: "hysteresisDb",
        label: "Hysteresis",
        kind: "number",
        value: 3,
        min: 0,
        max: 24,
        step: 1,
        suffix: "dB",
        title: "A note ends this far below the gate, so it does not chatter on noise.",
      },
      {
        key: "minNoteMs",
        label: "Min note",
        kind: "number",
        value: 20,
        min: 0,
        max: 10000,
        step: 5,
        suffix: "ms",
        title: "Notes shorter than this are discarded.",
      },
      {
        key: "minGapMs",
        label: "Min gap",
        kind: "number",
        value: 30,
        min: 0,
        max: 10000,
        step: 5,
        suffix: "ms",
        title: "Gaps shorter than this merge two runs into one note.",
      },
      {
        key: "envelopePoints",
        label: "Envelope points",
        kind: "number",
        value: 7,
        min: 3,
        max: 16,
        step: 1,
        title: "Envelope samples kept per note, at normalized positions.",
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
          "Window for the note's own YIN pitch track (jitter and f0). Raised to at least ~3 periods of the lowest f0.",
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
        title:
          "Step between those pitch frames; fine values resolve intra-note jitter and vibrato.",
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
        title: "Lowest expected fundamental for the per-note pitch track and periodicity proxy.",
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
        title: "Highest expected fundamental for the per-note pitch track and periodicity proxy.",
      },
    ],
  },
];
