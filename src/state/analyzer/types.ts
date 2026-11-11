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
import type { LoudnessResult as LoudnessPayload } from "../../bindings/LoudnessResult";
import type { CalibratedSeriesResult as CalibratedSeriesPayload } from "../../bindings/CalibratedSeriesResult";
import type { NoteMetricsResult as NoteMetricsPayload } from "../../bindings/NoteMetricsResult";
import type { ModulationResult as ModulationPayload } from "../../bindings/ModulationResult";
import type { MaskingResult as MaskingPayload } from "../../bindings/MaskingResult";
import type { SpatialResult as SpatialPayload } from "../../bindings/SpatialResult";

import type { AnalyzerId as GeneratedAnalyzerId } from "../../bindings/AnalyzerId";

/** The analyzer ids, generated from the Rust `AnalyzerId` (M15.B / ADR-28). */
export type AnalyzerId = GeneratedAnalyzerId;

/** Grouping used by the Sidebar, generated from the Rust `Section` (M15.B). */
export type AnalyzerSection = import("../../bindings/Section").Section;

// --- view descriptors ------------------------------------------------------

/**
 * How a pitch track is presented (M36), declared per detector in `defs/pitch.ts`.
 *
 * Reliability capabilities are **descriptor data**, never inferred from an id prefix:
 * a `series` view with no `pitchDisplay` is an ordinary scalar track.
 */
export interface PitchDisplay {
  /** The per-frame reliability track `PitchResult.confidence` carries for this detector. */
  confidence: "voicing" | "periodicity" | "none";
  /** Label the frequency axis with note names (and Hz) at sufficient zoom. */
  noteLabels: boolean;
  /** Whether this detector's track can be composed onto a spectrogram's heatmap. */
  spectrogramOverlay: boolean;
  /**
   * A **display guide** on the confidence scale (a reading aid drawn as a reference
   * line). The engine does not return a detector decision threshold, so this is never
   * presented as one.
   */
  confidenceThreshold?: number;
}

/** A readout beside a series chart that names a per-tool option the track depends on. */
export interface SeriesContext {
  label: string;
  /** The per-tool option key, read from the tool store (e.g. `windowMs`). */
  option: string;
  format: (value: number) => string;
  title?: string;
}

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
  /** Pitch-specific presentation (a reliability track, note labels, overlay capability). */
  pitchDisplay?: PitchDisplay;
  /**
   * The modulation rate (Hz) the model weights (M36). Declared as descriptor data —
   * never inferred from an id — so the band × rate drill-down can mark it.
   */
  rateTarget?: number;
  /** A context readout beside the chart (the option a track's meaning depends on). */
  context?: SeriesContext;
  /**
   * How one sample relates to time, so the line is drawn honestly rather than implying
   * a measurement between samples:
   * - `frame-centre` — one measurement per frame, at the frame's centre. Drawn linear,
   *   with visible points when the samples are sparse enough to be distinct.
   * - `block` — the value summarises a block of time (a window aggregate such as an
   *   RMS frame or an EBU R128 block), drawn as a step that holds forward from the
   *   timestamp (`stepped({ align: 1 })`).
   * - `step` — the value changes **at** its timestamp and holds forward (a count or a
   *   state), drawn as a forward step.
   * Absent means unspecified; the chart then falls back to `style`.
   */
  sampling?: "frame-centre" | "block" | "step";
  /**
   * What a bounded scale physically means (e.g. `flatness 0 = tonal, 1 = noise-like`),
   * shown beside the chart. A ratio is never presented as generic percent.
   */
  boundedMeaning?: string;
  /** The analyzer that shows the underlying spectrum (centroid/rolloff/flatness/…). */
  supportingTool?: AnalyzerId;
  /**
   * Fill the area under the curve. Reserved for a quantity where accumulation from a
   * meaningful baseline is intended (a level envelope), never for a non-negative
   * measure merely because it sits above zero.
   */
  fill?: boolean;
}

/**
 * How a matrix heatmap maps its values onto the colour ramp (M36). Resolved once by
 * `components/analyzer/heatmapScale.ts` — the pixels and the colourbar share it.
 */
export interface MatrixColorSemantics {
  /**
   * The colour domain:
   * - `result` (default) — the result's own `minValue`/`maxValue`,
   * - `symmetric` — zero-centred, with a **diverging** ramp (signed coefficients),
   * - `{ min, max }` — a declared fixed domain.
   */
  colorDomain?: "result" | "symmetric" | { min: number; max: number };
  /** The value transform the ramp applies (default `linear`). */
  colorTransform?: "linear" | "log1p";
}

/** A frame × band heatmap. */
export interface MatrixView extends MatrixColorSemantics {
  kind: "matrix";
  yLabel: string;
  /** Label for a band row (bottom-up). */
  formatBand: (band: number) => string;
  formatValue: (value: number) => string;
  /** The value's name for the colourbar (the result's unit is appended by the scale). */
  valueLabel: string;
  /**
   * The band-axis model, for copy: what the rows *are*. Used when the result's own
   * `model` field is absent (the payload's value wins).
   */
  axisModel?: string;
  /** Label **every** band row (a chromagram's 12 pitch classes) when height permits. */
  labelEveryBand?: boolean;
  /** Draw pitch-class row lines (chromagram). */
  noteGrid?: boolean;
  /**
   * `formatBand` receives the result's `bands[i]` value (e.g. Hz) rather than the row
   * index — the critical-band matrix labels rows by band centre frequency (M26).
   */
  bandAxisIsValue?: boolean;
  /**
   * The band's exact low/high edges (Hz), used when the result carries no
   * `bandEdges`. Either a fixed list or a builder from the band count —
   * `spectralContrast` measures octave bands between 0 and 1600 Hz.
   */
  bandEdges?: number[] | ((bins: number) => number[]);
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

/** Sone/phon loudness over time (M27). */
export interface LoudnessView {
  kind: "loudness";
}

/** Spectrum with its threshold in quiet / masking threshold overlays (M30). */
export interface MaskingView {
  kind: "masking";
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
  | ModulationView
  | LoudnessView
  | MaskingView;

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

/** Moore–Glasberg loudness (sones/phons) over time (M27). */
export interface LoudnessResult extends LoudnessPayload {
  tool: "loudness";
}

/** Spectrum with its masking curves (M30). */
export interface MaskingResult extends MaskingPayload {
  tool: "masking";
}

/** Perceived sharpness (acum) per frame, under a calibration (M28). */
export interface CalibratedSeriesResult extends CalibratedSeriesPayload {
  tool: AnalyzerId;
}

/** Mid/side levels and inter-channel correlation (M31). */
export interface SpatialResult extends SpatialPayload {
  tool: "spatial";
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
  | LraResult
  | LoudnessResult
  | MaskingResult
  | CalibratedSeriesResult
  | SpatialResult;
