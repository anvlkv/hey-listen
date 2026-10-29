import type { AnalyzerId, AnyAnalysisResult } from "../analyzer";
import type { SharedParamsDto } from "../analysis";
import type { ResultSummary } from "../../bindings/ResultSummary";

/**
 * The comparison contract (M25) — the shapes `run_comparison`, `compare_peer_setup`
 * and `compare_live` exchange. The Rust types live in
 * `src-tauri/src/audio/analysis/compare/` and `commands/compare.rs`; these are their
 * JSON counterparts. See `docs/comparison.md`.
 */

/** A `start..end` span in source seconds. */
export interface Span {
  start: number;
  end: number;
}

/** A project's source shape (rate / channels / duration). */
export interface SourceShape {
  sampleRate: number;
  channels: number;
  duration: number;
}

/** One side's setup as `run_comparison` takes it. */
export interface CompareSetupDto {
  start: number;
  end: number;
  params: SharedParamsDto;
  options: Record<string, number>;
}

/** One side's result in a comparison. */
export interface CompareSideDto {
  project: string | null;
  source: SourceShape | null;
  window: Span;
  params: SharedParamsDto;
  /** The tool's effective options (defaults included). */
  options: Record<string, number>;
  summary: ResultSummary;
  /** Present unless the caller asked for `summaryOnly`. */
  result?: AnyAnalysisResult;
  /** The CLI adds the project file's path. */
  file?: string;
}

/** One differing setting between the two sides. */
export interface MismatchDto {
  key: string;
  a: unknown;
  b: unknown;
}

/** Whether (and how far) two results can be diffed. */
export interface ComparabilityDto {
  aligned: boolean;
  overlap: Span | null;
  mismatches: MismatchDto[];
  filtersDiffer: boolean;
}

/** The stats of a numeric delta (`B − A`). */
export interface DeltaStatsDto {
  matched: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  rms: number | null;
  maxAbs: number | null;
  meanAbs: number | null;
  correlation: number | null;
}

/** The fields every delta variant carries (serde flattens a `DeltaHeader`). */
interface DiffHeader {
  summary: string;
  maxAbs?: number;
}

export interface SeriesDiffDto extends DiffHeader {
  kind: "series";
  stats: DeltaStatsDto;
  times: number[];
  values: (number | null)[];
  a: (number | null)[];
  b: (number | null)[];
}

export interface SpectrumDiffDto extends DiffHeader {
  kind: "spectrum";
  stats: DeltaStatsDto;
  freqs: number[];
  values: number[];
}

export interface MatrixDiffDto extends DiffHeader {
  kind: "matrix";
  stats: DeltaStatsDto;
  times: number[];
  bins: number;
  values: number[];
}

export interface FieldDeltaDto {
  key: string;
  a: number;
  b: number;
  delta: number;
}

export interface ScalarDiffDto extends DiffHeader {
  kind: "scalar";
  fields: FieldDeltaDto[];
}

/** A delta variant the M25 view does not chart (M25.A renders it). */
export interface OtherDiffDto extends DiffHeader {
  kind: "events" | "notes" | "modulation" | "waveform";
}

export type ComparisonDiffDto =
  SeriesDiffDto | SpectrumDiffDto | MatrixDiffDto | ScalarDiffDto | OtherDiffDto;

/** The `run_comparison` response. */
export interface ComparisonDto {
  tool: AnalyzerId;
  a: CompareSideDto;
  b: CompareSideDto;
  comparability: ComparabilityDto;
  diff?: ComparisonDiffDto;
}

/** The reference project's setup (`compare_peer_setup`). */
export interface PeerSetupDto {
  project: string | null;
  source: SourceShape | null;
  window: Span;
  params: SharedParamsDto;
  options: Record<string, number>;
  hasFilter: boolean;
}

/** One side's live markers. */
export interface LiveSideDto {
  playhead: number | null;
  cursorTime: number | null;
  cursorFreq: number | null;
  cursorMod: number | null;
}

/** The `compare_live` poll response. */
export interface CompareLiveDto {
  /** False once the reference project is closed. */
  open: boolean;
  revision: number;
  a: LiveSideDto;
  b: LiveSideDto;
}

/** A project the picker can reference. */
export interface CompareTargetDto {
  label: string;
  name: string;
  source: SourceShape | null;
  window: Span | null;
  hasFilter: boolean;
  /** False for a project with no source: listed but disabled. */
  ready: boolean;
}

/** A compare view a popout shows (registered in the core). */
export interface CompareViewDto {
  tool: string;
  /** The reference project's window label. */
  with: string;
}
