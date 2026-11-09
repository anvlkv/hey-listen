/**
 * The analyzer tool matrix (M8) — the single source the parametrized smoke test
 * iterates. Both vocabularies are **imported**, never re-declared: the ids come from the
 * generated `AnalyzerId`, the views from the renderer's `AnalyzerView` union in
 * `src/state/analyzer/types.ts` (not the Rust result `Family` or the Sidebar `Section`);
 * `docs/testing.md` → "Analyzer tools — every tool" lists the same ids.
 *
 * Keep the ids in `AnalyzerId` order: every id must appear here, or a tool silently
 * escapes the "every tool" smoke test. All of this is type-only, so it is erased at run
 * time.
 */
import type { AnalyzerId } from "../../src/bindings/AnalyzerId";
import type { AnalyzerView } from "../../src/state/analyzer/types";

/** The renderer's view kinds, derived from the frontend's `AnalyzerView` union. */
export type ViewKind = AnalyzerView["kind"];

export interface AnalyzerTool {
  id: AnalyzerId;
  title: string;
  view: ViewKind;
}

export const ANALYZER_TOOLS: AnalyzerTool[] = [
  { id: "waveform", title: "Waveform", view: "waveform" },
  { id: "levels", title: "Level meters", view: "readouts" },
  { id: "frameRms", title: "Amplitude envelope", view: "series" },
  { id: "spectrum", title: "Spectrum", view: "spectrum" },
  { id: "spectrogram", title: "Spectrogram", view: "spectrogram" },
  { id: "melSpectrogram", title: "Mel spectrogram", view: "matrix" },
  { id: "mfcc", title: "MFCC", view: "matrix" },
  { id: "chromagram", title: "Chromagram", view: "matrix" },
  { id: "spectralCentroid", title: "Spectral centroid", view: "series" },
  { id: "spectralFlux", title: "Spectral flux", view: "series" },
  { id: "spectralRolloff", title: "Spectral rolloff", view: "series" },
  { id: "spectralFlatness", title: "Spectral flatness", view: "series" },
  { id: "spectralContrast", title: "Spectral contrast", view: "matrix" },
  { id: "spectralBandwidth", title: "Spectral bandwidth", view: "series" },
  { id: "spectralEntropy", title: "Spectral entropy", view: "series" },
  { id: "spectralCrest", title: "Spectral crest factor", view: "series" },
  { id: "harmonicRatio", title: "Harmonic ratio", view: "series" },
  { id: "zeroCrossingRate", title: "Zero-crossing rate", view: "series" },
  { id: "modulation", title: "AM/FM modulation", view: "modulation" },
  { id: "pitchPyin", title: "Pitch (pYIN)", view: "series" },
  { id: "pitchYin", title: "Pitch (YIN)", view: "series" },
  { id: "pitchAutocorr", title: "Pitch (autocorrelation)", view: "series" },
  { id: "noteMetrics", title: "Note segments", view: "noteMetrics" },
  { id: "tempo", title: "Tempo", view: "rhythm" },
  { id: "onsets", title: "Onsets", view: "rhythm" },
  { id: "downbeats", title: "Downbeats", view: "rhythm" },
  { id: "loudnessIntegrated", title: "Integrated LUFS", view: "readouts" },
  { id: "loudnessMomentary", title: "Loudness (momentary)", view: "series" },
  { id: "loudnessRange", title: "Loudness range", view: "readouts" },
  { id: "criticalBands", title: "Critical bands", view: "matrix" },
  { id: "loudness", title: "Loudness (sone/phon)", view: "loudness" },
  { id: "specificLoudness", title: "Specific loudness", view: "matrix" },
  { id: "sharpness", title: "Sharpness", view: "series" },
  { id: "roughness", title: "Roughness", view: "series" },
  { id: "fluctuationStrength", title: "Fluctuation strength", view: "series" },
  { id: "masking", title: "Masking", view: "masking" },
  { id: "tonality", title: "Tonality", view: "series" },
  { id: "spatial", title: "Spatial", view: "series" },
];
