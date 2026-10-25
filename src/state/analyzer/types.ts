/**
 * The analyzer registry's type surface: the tool ids and Sidebar sections, the chart
 * view descriptors the Workbench renders, the registry entry shape, and the analysis
 * result payloads exchanged over IPC.
 *
 * Result payloads are generated from the Rust `AnalysisResult` variants via ts-rs
 * (`src/bindings/`) — only the `tool` discriminant that tags each analysis result is
 * declared here, so a Rust field change flows through automatically.
 *
 * See `docs/analysis-tools.md`.
 */
import type { WaveformResult as WaveformPayload } from "../../bindings/WaveformResult";
import type { SpectrumResult as SpectrumPayload } from "../../bindings/SpectrumResult";
import type { SpectrogramResult as SpectrogramPayload } from "../../bindings/SpectrogramResult";
import type { LevelsResult as LevelsPayload } from "../../bindings/LevelsResult";
import type { SeriesResult as SeriesPayload } from "../../bindings/SeriesResult";
import type { PitchResult as PitchPayload } from "../../bindings/PitchResult";
import type { MatrixResult as MatrixPayload } from "../../bindings/MatrixResult";
import type { RhythmResult as RhythmPayload } from "../../bindings/RhythmResult";
import type { LufsResult as LufsPayload } from "../../bindings/LufsResult";
import type { LraResult as LraPayload } from "../../bindings/LraResult";
import type { NoteMetricsResult as NoteMetricsPayload } from "../../bindings/NoteMetricsResult";
import type { ModulationResult as ModulationPayload } from "../../bindings/ModulationResult";

export type AnalyzerId =
  | "waveform"
  | "levels"
  | "frameRms"
  | "spectrum"
  | "spectrogram"
  | "melSpectrogram"
  | "mfcc"
  | "chromagram"
  | "spectralCentroid"
  | "spectralFlux"
  | "spectralRolloff"
  | "spectralFlatness"
  | "spectralContrast"
  | "spectralBandwidth"
  | "spectralEntropy"
  | "spectralCrest"
  | "harmonicRatio"
  | "zeroCrossingRate"
  | "modulation"
  | "pitchPyin"
  | "pitchYin"
  | "pitchAutocorr"
  | "noteMetrics"
  | "tempo"
  | "onsets"
  | "downbeats"
  | "loudnessIntegrated"
  | "loudnessMomentary"
  | "loudnessRange";

/** Grouping used by the Sidebar (mirrors `docs/analysis-tools.md`). */
export type AnalyzerSection = "time" | "spectral" | "pitch" | "rhythm" | "loudness";

// --- view descriptors ------------------------------------------------------

/** A single-series line chart over time (or frequency). */
export interface SeriesView {
  kind: "series";
  yLabel: string;
  formatY: (value: number) => string;
  /** Draw dots as well as the line (sparse tracks such as pitch). */
  points?: boolean;
  /** Line/area rendering: a plain line, area fill, step, or impulse stems. */
  style?: "line" | "area" | "stepped" | "stems";
  /** y-axis scale — `log` is only valid for strictly positive series. */
  yScale?: "linear" | "log";
  /** Fixed y-range (e.g. `[0, 1]` for bounded ratios). */
  yRange?: [number, number];
  /** Horizontal reference line (a target or floor). */
  reference?: { value: number; label: string };
  /** Draw f0 gridlines at semitone frequencies (pitch tracks). */
  semitoneGrid?: boolean;
}

/** A frame × band heatmap. */
export interface MatrixView {
  kind: "matrix";
  yLabel: string;
  /** Label for a band row (bottom-up). */
  formatBand: (band: number) => string;
  formatValue: (value: number) => string;
  /** Draw pitch-class row lines (chromagram). */
  noteGrid?: boolean;
}

export interface WaveformView {
  kind: "waveform";
}
export interface SpectrumView {
  kind: "spectrum";
}
export interface SpectrogramView {
  kind: "spectrogram";
}
export interface ReadoutsView {
  kind: "readouts";
}

/** Onset-strength envelope with event markers (rhythm tools). */
export interface RhythmView {
  kind: "rhythm";
  /** Which event sets to draw as markers on the envelope. */
  markers: ("beats" | "onsets" | "downbeats")[];
}

/** Detected note segments: summary cards over a per-note table (M18). */
export interface NoteMetricsView {
  kind: "noteMetrics";
}

/** AM and FM modulation spectra on one modulation-rate axis (M20). */
export interface ModulationView {
  kind: "modulation";
}

export type AnalyzerView =
  | SeriesView
  | MatrixView
  | WaveformView
  | SpectrumView
  | SpectrogramView
  | ReadoutsView
  | RhythmView
  | NoteMetricsView
  | ModulationView;

/** A per-tool param rendered in the params popover (below the shared params). */
export interface ToolParamField {
  /** camelCase key as it crosses IPC (matches `audio/analysis/types.rs` → `ToolOptions`). */
  key: string;
  label: string;
  kind: "number" | "select" | "toggle";
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  title?: string;
  options?: { value: number; label: string }[];
  /**
   * What the value configures: the analysis engine (`"engine"`, the default) or only
   * the chart's display (`"view"`). View-only values stay in the per-tool store but
   * never cross IPC — the engine would reject them as unknown options (M16).
   */
  target?: "engine" | "view";
}

/** Registry entry: how the tool is listed, titled, charted, and explained. */
export interface AnalyzerDef {
  id: AnalyzerId;
  title: string;
  description: string;
  /**
   * "About" popover copy: what the tool shows and when to use it. Markdown —
   * paragraphs plus `**bold**` / `*italic*` lead-ins (the Sidebar previews it as
   * plain text).
   */
  about: string;
  /** Search terms for the Sidebar search box (`docs/analysis-tools.md`). */
  keywords: string[];
  section: AnalyzerSection;
  view: AnalyzerView;
  params?: ToolParamField[];
}

// --- result payloads (mirrors `audio/analysis/`) -------------------------

export interface WaveformResult extends WaveformPayload {
  tool: "waveform";
}

export interface SpectrumResult extends SpectrumPayload {
  tool: "spectrum";
}

export interface SpectrogramResult extends SpectrogramPayload {
  tool: "spectrogram";
}

export interface LevelsResult extends LevelsPayload {
  tool: "levels";
}

/** One scalar value per frame, over time; `null` entries are gaps. */
export interface SeriesResult extends SeriesPayload {
  tool: AnalyzerId;
}

/** A pitch track: the f0 series plus the voiced-frame summary. */
export interface PitchResult extends PitchPayload {
  tool: AnalyzerId;
}

/** A frame × band matrix, frame-major in `values`. */
export interface MatrixResult extends MatrixPayload {
  tool: AnalyzerId;
}

/** Tempo / onset / downbeat analysis: an onset-strength envelope plus events. */
export interface RhythmResult extends RhythmPayload {
  tool: "tempo" | "onsets" | "downbeats";
}

/** Detected audio notes, the gaps between them, and per-note levels (M18). */
export interface NoteMetricsResult extends NoteMetricsPayload {
  tool: "noteMetrics";
}

/** AM/FM modulation spectra, their ranked peaks, and depth readouts (M20). */
export interface ModulationResult extends ModulationPayload {
  tool: "modulation";
}

export interface LufsResult extends LufsPayload {
  tool: "loudnessIntegrated";
}

export interface LraResult extends LraPayload {
  tool: "loudnessRange";
}

/** Any analyzer result returned over IPC. */
export type AnyAnalysisResult =
  | WaveformResult
  | SpectrumResult
  | SpectrogramResult
  | SeriesResult
  | PitchResult
  | MatrixResult
  | LevelsResult
  | RhythmResult
  | NoteMetricsResult
  | ModulationResult
  | LufsResult
  | LraResult;
