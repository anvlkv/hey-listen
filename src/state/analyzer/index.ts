/**
 * Analyzer tools (M4+, all oxiaudio tools in M5): the registry the Sidebar lists
 * and the Workbench mounts, plus the shared runner every analyzer tab uses.
 *
 * This module is the package's public surface — it re-exports the same names the
 * old single-file `state/analyzer.ts` did, so importers need no changes. The parts
 * live in focused siblings: `types` (registry + result types), `format`/`view`
 * (chart descriptor helpers), `defs` (the registry data), `lookup` (queries),
 * `results` (latest-result signals), `options` (per-tool options), and `analysis`
 * (the debounced runner).
 */
export { ANALYZERS, ANALYZER_SECTIONS } from "./defs";
export { formatHz } from "./format";
export { analyzerById, analyzersInSection, isAnalyzerId, matchesQuery } from "./lookup";
export { latestResult } from "./results";
export {
  applyOptionPatch,
  engineOptions,
  loadToolOptions,
  optionDefaults,
  resetToolOptions,
  setToolOption,
  setToolOptions,
  toolOptions,
} from "./options";
export { createAnalysis } from "./analysis";
export type { AnalysisHandle } from "./analysis";
export type {
  AnalyzerDef,
  AnalyzerId,
  AnalyzerView,
  AnyAnalysisResult,
  LevelsResult,
  LraResult,
  LufsResult,
  MatrixResult,
  MatrixView,
  ModulationResult,
  NoteMetricsResult,
  PitchResult,
  RhythmResult,
  RhythmView,
  SeriesResult,
  SeriesView,
  SpectrogramResult,
  SpectrumResult,
  ToolParamField,
  WaveformResult,
} from "./types";
