/**
 * The analyzer tool matrix (M8) — the single source the parametrized smoke test
 * iterates. The vocabularies are **imported**, never re-declared: the ids come from the
 * generated `AnalyzerId`, the views from the renderer's `AnalyzerView` union, and the
 * sections from the generated `Section` (`src/state/analyzer/types.ts` → `AnalyzerSection`).
 * `docs/testing.md` → "Analyzer tools — every tool" lists the same ids.
 *
 * Keep the ids in `AnalyzerId` order: every id must appear here, or a tool silently
 * escapes the "every tool" smoke test. All of this is type-only, so it is erased at run
 * time.
 */
import type { AnalyzerId } from "../../src/bindings/AnalyzerId";
import type { Section as AnalyzerSection } from "../../src/bindings/Section";
import type { AnalyzerView } from "../../src/state/analyzer/types";

/** The renderer's view kinds, derived from the frontend's `AnalyzerView` union. */
export type ViewKind = AnalyzerView["kind"];

export interface AnalyzerTool {
  id: AnalyzerId;
  title: string;
  view: ViewKind;
  /** The activity-bar tab the tool lives under (mirrors `AnalyzerSection`). */
  section: AnalyzerSection;
}

export const ANALYZER_TOOLS: AnalyzerTool[] = [
  { id: "waveform", title: "Waveform", view: "waveform", section: "time" },
  { id: "levels", title: "Level meters", view: "readouts", section: "time" },
  { id: "frameRms", title: "Amplitude envelope", view: "series", section: "time" },
  { id: "spectrum", title: "Spectrum", view: "spectrum", section: "spectral" },
  { id: "spectrogram", title: "Spectrogram", view: "spectrogram", section: "spectral" },
  { id: "melSpectrogram", title: "Mel spectrogram", view: "matrix", section: "spectral" },
  { id: "mfcc", title: "MFCC", view: "matrix", section: "spectral" },
  { id: "chromagram", title: "Chromagram", view: "matrix", section: "spectral" },
  { id: "spectralCentroid", title: "Spectral centroid", view: "series", section: "spectral" },
  { id: "spectralFlux", title: "Spectral flux", view: "series", section: "spectral" },
  { id: "spectralRolloff", title: "Spectral rolloff", view: "series", section: "spectral" },
  { id: "spectralFlatness", title: "Spectral flatness", view: "series", section: "spectral" },
  { id: "spectralContrast", title: "Spectral contrast", view: "matrix", section: "spectral" },
  { id: "spectralBandwidth", title: "Spectral bandwidth", view: "series", section: "spectral" },
  { id: "spectralEntropy", title: "Spectral entropy", view: "series", section: "spectral" },
  { id: "spectralCrest", title: "Spectral crest factor", view: "series", section: "spectral" },
  { id: "harmonicRatio", title: "Harmonic ratio", view: "series", section: "spectral" },
  { id: "zeroCrossingRate", title: "Zero-crossing rate", view: "series", section: "spectral" },
  { id: "modulation", title: "AM/FM modulation", view: "modulation", section: "spectral" },
  { id: "pitchPyin", title: "Pitch (pYIN)", view: "series", section: "pitch" },
  { id: "pitchYin", title: "Pitch (YIN)", view: "series", section: "pitch" },
  { id: "pitchAutocorr", title: "Pitch (autocorrelation)", view: "series", section: "pitch" },
  { id: "noteMetrics", title: "Note segments", view: "noteMetrics", section: "pitch" },
  { id: "tempo", title: "Tempo", view: "rhythm", section: "rhythm" },
  { id: "onsets", title: "Onsets", view: "rhythm", section: "rhythm" },
  { id: "downbeats", title: "Downbeats", view: "rhythm", section: "rhythm" },
  { id: "loudnessIntegrated", title: "Integrated LUFS", view: "readouts", section: "loudness" },
  { id: "loudnessMomentary", title: "Loudness (momentary)", view: "series", section: "loudness" },
  { id: "loudnessRange", title: "Loudness range", view: "readouts", section: "loudness" },
  { id: "criticalBands", title: "Critical bands", view: "matrix", section: "perception" },
  { id: "loudness", title: "Loudness (sone/phon)", view: "loudness", section: "perception" },
  { id: "specificLoudness", title: "Specific loudness", view: "matrix", section: "perception" },
  { id: "sharpness", title: "Sharpness", view: "series", section: "perception" },
  { id: "roughness", title: "Roughness", view: "series", section: "perception" },
  {
    id: "fluctuationStrength",
    title: "Fluctuation strength",
    view: "series",
    section: "perception",
  },
  { id: "masking", title: "Masking", view: "masking", section: "perception" },
  { id: "tonality", title: "Tonality", view: "series", section: "perception" },
  { id: "spatial", title: "Spatial", view: "series", section: "perception" },
];
