/**
 * The analyzer tool matrix (M8) — the single source the parametrized smoke test
 * iterates, mirroring `docs/testing.md` → "Analyzer tools — every tool" and the
 * registry in `src/state/analyzer/`.
 */

export type ViewKind =
  | "waveform"
  | "spectrum"
  | "spectrogram"
  | "matrix"
  | "series"
  | "readouts"
  | "noteMetrics"
  | "events";

export interface AnalyzerTool {
  id: string;
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
  { id: "pitchPyin", title: "Pitch (pYIN)", view: "series" },
  { id: "pitchYin", title: "Pitch (YIN)", view: "series" },
  { id: "pitchAutocorr", title: "Pitch (autocorrelation)", view: "series" },
  { id: "noteMetrics", title: "Note segments", view: "noteMetrics" },
  { id: "tempo", title: "Tempo", view: "readouts" },
  { id: "onsets", title: "Onsets", view: "events" },
  { id: "downbeats", title: "Downbeats", view: "events" },
  { id: "loudnessIntegrated", title: "Integrated LUFS", view: "readouts" },
  { id: "loudnessMomentary", title: "Loudness (momentary)", view: "series" },
  { id: "loudnessRange", title: "Loudness range", view: "readouts" },
];
