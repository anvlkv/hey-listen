import type { AnalysisTab } from "../components/AnalysisTabs";
import type { DeckCard } from "../components/ImageDeck";
import { SECTION_ICON_SVG } from "./section-icons";
import { link } from "./site";

/**
 * The landing's feature copy, kept out of the page so the markup stays scannable.
 * Every image here is a captured element crop of the running app, in
 * `landing/public/images/`; none is an exported chart.
 */
export const analysisTabs: AnalysisTab[] = [
  {
    id: "time",
    label: "Time",
    icon: SECTION_ICON_SVG.time,
    title: "Waveform, levels, and the amplitude envelope.",
    blurb:
      "See where an event begins, how its level changes, and what the short-term RMS looks like next to the peak.",
    image: link("images/analyzers/time.png"),
    alt: "The Waveform analyzer panel, with its peak and RMS readout.",
  },
  {
    id: "spectral",
    label: "Spectral",
    icon: SECTION_ICON_SVG.spectral,
    title: "Spectrum, spectrogram, and the spectral descriptors.",
    blurb:
      "Move from a single window's spectrum to a spectrogram, mel bands, MFCC, chroma, centroid, flatness, flux, and the rest.",
    caveat:
      "A descriptor is a summary, not the sound. Read its About panel before comparing two windows.",
    image: link("images/analyzers/spectral.png"),
    alt: "The Spectrum analyzer panel, averaged over the analysis window.",
  },
  {
    id: "pitch",
    label: "Pitch",
    icon: SECTION_ICON_SVG.pitch,
    title: "Three pitch tracks, with their own bounds.",
    blurb:
      "pYIN, YIN, and autocorrelation show the fundamental over time. Each tool keeps its own frequency bounds and reports where the voiced frames run out.",
    image: link("images/analyzers/pitch.png"),
    alt: "The Pitch (YIN) analyzer panel, with its confidence track.",
  },
  {
    id: "rhythm",
    label: "Rhythm",
    icon: SECTION_ICON_SVG.rhythm,
    title: "Tempo, onsets, downbeats, and note segments.",
    blurb:
      "Find the pulse and the attacks, then read the detected notes with their durations, gaps, and per-note level.",
    image: link("images/analyzers/rhythm.png"),
    alt: "The Tempo analyzer panel, with its onset strength and salience.",
  },
  {
    id: "loudness",
    label: "Loudness",
    icon: SECTION_ICON_SVG.loudness,
    title: "Programme loudness, as EBU R128 defines it.",
    blurb:
      "Integrated loudness, momentary loudness, and loudness range. These are programme measures; the frame-RMS envelope is the shorter-term level in the Time section.",
    image: link("images/analyzers/loudness.png"),
    alt: "The Loudness (momentary) analyzer panel in LUFS.",
  },
  {
    id: "perception",
    label: "Perception",
    icon: SECTION_ICON_SVG.perception,
    title: "Auditory models, with their calibration in view.",
    blurb:
      "Critical bands, loudness in sones and phons, specific loudness, sharpness, roughness, fluctuation strength, tonality, masking, and spatial cues.",
    caveat:
      "These are models, not measurements of a listener. Absolute units need a calibration level; read the About panel before quoting one.",
    image: link("images/analyzers/perception.png"),
    alt: "The Sharpness analyzer panel, with its per-frame sharpness curve.",
  },
];

export const sourceCards: DeckCard[] = [
  {
    id: "add-audio",
    label: "Add audio",
    caption:
      "Open a file, then keep it embedded, linked, or watched with a live link.",
    image: link("images/sources/add-audio.png"),
    alt: "The Sources rail with a loaded file and all three storage choices — Embedded, Linked (selected), and Live link.",
  },
  {
    id: "kinds",
    label: "Choose a source",
    caption:
      "A file, a microphone, system audio, an application, a mic-and-system mix, or a synth graph.",
    image: link("images/sources/kinds.png"),
    alt: "The source-kind list open: Audio file, Microphone, System audio, Application, Mic + system, Synth (graph).",
  },
  {
    id: "application",
    label: "Application",
    caption: "Capture one application's output: choose the app, set gain, then record.",
    image: link("images/sources/application.png"),
    alt: "The Sources rail set to Application, with its application picker, gain, level and record controls.",
  },
  {
    id: "synth",
    label: "Synth graph",
    caption: "Edit a graph in the Workbench, then render it into the timeline.",
    image: link("images/sources/synth.png"),
    alt: "The Sources rail in Synth mode, with length, Live and Render controls.",
  },
];

/** The two export surfaces: the window's audio and the analysis result. */
export const exportCards: DeckCard[] = [
  {
    id: "audio",
    label: "Export audio",
    caption:
      "The analysis window as WAV, FLAC, or AIFF — with depth, channels, and an optional filter pass.",
    image: link("images/export-rail.png"),
    alt: "The Export rail: the analysis window's range, format, depth, channels, the filter switch, and an Export audio button.",
    background: "#241338",
  },
  {
    id: "data",
    label: "Export data",
    caption:
      "A tool's result as provenance JSON, a wide CSV with its sidecar, or the chart as a PNG.",
    image: link("images/export-popover.png"),
    alt: "The Export popover for an analysis: Data to JSON, Data to CSV, Chart to PNG, Copy CSV, and a sidecar checkbox.",
    background: "#1f0e33",
  },
];
