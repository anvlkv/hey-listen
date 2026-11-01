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

/** The relative extents of a comparison and the span the delta covers (M25.B). */
export interface AlignmentDto {
  /** The owner's window length in seconds. */
  aDuration: number;
  /** The reference's window length in seconds. */
  bDuration: number;
  /** The fine-tune offset δ, positive = the reference is later. */
  bOffset: number;
  /** The relative span the delta covers, in owner coordinates; `null` when the shifted
   * windows do not meet. */
  common: Span | null;
}

/** Whether (and how far) two results can be diffed. */
export interface ComparabilityDto {
  aligned: boolean;
  alignment: AlignmentDto;
  /** The absolute-time intersection — information only; it no longer gates the delta. */
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

export interface SeriesDeltaDto extends DiffHeader {
  stats: DeltaStatsDto;
  times: number[];
  values: (number | null)[];
  a: (number | null)[];
  b: (number | null)[];
}

export interface SeriesDiffDto extends SeriesDeltaDto {
  kind: "series";
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
  /** A's frame times on the relative axis. */
  times: number[];
  /** One flag per column; `false` = A has a frame there but B has no counterpart (M25.B). */
  columns: boolean[];
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

/** One matched event pair. */
export interface EventPairDto {
  a: number;
  b: number;
  /** `B − A`, in seconds. */
  dt: number;
}

/** How two event lists line up (matched by nearest time). */
export interface EventPairingDto {
  matched: number;
  onlyA: number;
  onlyB: number;
  meanAbsDt?: number;
  pairs: EventPairDto[];
  onlyATimes: number[];
  onlyBTimes: number[];
}

export interface EventsDiffDto extends DiffHeader {
  kind: "events";
  /** The onset-strength envelope delta; absent when the frame grids differ. */
  envelope?: SeriesDeltaDto;
  onsets: EventPairingDto;
  beats: EventPairingDto;
  downbeats: EventPairingDto;
}

/** One matched note pair, with the span / level deltas. */
export interface NotePairDto {
  aStart: number;
  bStart: number;
  dt: number;
  aDuration: number;
  bDuration: number;
  durationDelta: number;
  aRmsDb: number;
  bRmsDb: number;
  rmsDeltaDb: number;
}

export interface NotesDiffDto extends DiffHeader {
  kind: "notes";
  matched: number;
  onlyA: number;
  onlyB: number;
  meanAbsDt?: number;
  pairs: NotePairDto[];
  onlyAStarts: number[];
  onlyBStarts: number[];
}

/** One modulation line's per-bin delta. */
export interface LineDeltaDto {
  stats: DeltaStatsDto;
  values: number[];
}

export interface ModulationDiffDto extends DiffHeader {
  kind: "modulation";
  /** The shared modulation-rate axis (Hz). */
  rateHz: number[];
  am: LineDeltaDto;
  fm: LineDeltaDto;
}

export interface WaveformDiffDto extends DiffHeader {
  kind: "waveform";
  /** Envelope buckets present in `times` / `values` (A's bucket times sampled against B). */
  buckets: number;
  /** The original bucket count when `maxPoints` thinned the arrays. */
  sourceBuckets?: number;
  /** The sampled bucket times on the relative axis. */
  times: number[];
  values: number[];
}

export type ComparisonDiffDto =
  | SeriesDiffDto
  | SpectrumDiffDto
  | MatrixDiffDto
  | EventsDiffDto
  | NotesDiffDto
  | ModulationDiffDto
  | WaveformDiffDto
  | ScalarDiffDto;

/** The `run_comparison` response. */
export interface ComparisonDto {
  tool: AnalyzerId;
  a: CompareSideDto;
  b: CompareSideDto;
  comparability: ComparabilityDto;
  diff?: ComparisonDiffDto;
  /** The content fingerprint of the reference snapshot that would be saved (M25.C). */
  savedFingerprint?: string;
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
  tool: AnalyzerId;
  /** The live reference project's window label, or the saved reference's name. */
  with: string;
  /** Whether `with` names the project's saved snapshot rather than a live project. */
  saved?: boolean;
  /** The view's fine-tune offset (tab entries only; a popout reports it on its own). */
  offset?: number;
}
