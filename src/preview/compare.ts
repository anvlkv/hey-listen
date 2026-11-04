/**
 * Comparison fixtures for the preview surfaces.
 *
 * The compare view is a real Workbench tab, so a preview surface has to hand the
 * component a resolved `run_comparison` reply. This module builds one from the same
 * analysis fixtures the analyzer tabs use: A is the measured result, B a small,
 * deterministic perturbation, and the delta is computed here exactly as the core
 * would (relative axis, matched values).
 *
 * Only the families the preview compares (readouts and series) need a hand-built
 * delta; any other tool falls back to the scalar field delta.
 */

import type { AnyAnalysisResult } from "../state/analyzer/types";
import type { SharedParamsDto } from "../state/analysis";
import type {
  ComparisonDiffDto,
  ComparisonDto,
  DeltaStatsDto,
  FieldDeltaDto,
} from "../state/compare/types";
import type { ResultSummary } from "../bindings/ResultSummary";
import { FIXTURE_SECONDS, FIXTURE_SAMPLE_RATE } from "./signal";

/** One generated fixture entry (`src/preview/fixtures/analysis.json`). */
export interface AnalysisEntry {
  summary: ResultSummary;
  result: AnyAnalysisResult;
}

/** Read a generated fixture entry by tool id (undefined when the tool is unknown). */
export function analysisFixture(
  entries: Record<string, AnalysisEntry>,
  tool: string,
): AnalysisEntry | undefined {
  return entries[tool];
}

const SOURCE = { sampleRate: FIXTURE_SAMPLE_RATE, channels: 1, duration: FIXTURE_SECONDS };
const WINDOW = { start: 0, end: FIXTURE_SECONDS };
const PARAMS: SharedParamsDto = {
  fftSize: 2048,
  hop: 0.25,
  randomizedOverlap: false,
  windowFn: "hann",
  channel: null,
  resampleTo: null,
  freqMinHz: 0,
  freqMaxHz: 0,
};

function stats(values: (number | null)[]): DeltaStatsDto {
  const numbers = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (numbers.length === 0) {
    return {
      matched: 0,
      min: null,
      max: null,
      mean: null,
      rms: null,
      maxAbs: null,
      meanAbs: null,
      correlation: null,
    };
  }
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const rms = Math.sqrt(numbers.reduce((sum, value) => sum + value * value, 0) / numbers.length);
  const maxAbs = numbers.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  const meanAbs = numbers.reduce((sum, value) => sum + Math.abs(value), 0) / numbers.length;
  return {
    matched: numbers.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    mean,
    rms,
    maxAbs,
    meanAbs,
    correlation: null,
  };
}

function fieldDeltas(a: Record<string, unknown>, b: Record<string, unknown>): FieldDeltaDto[] {
  return Object.keys(a)
    .filter((key) => typeof a[key] === "number" && typeof b[key] === "number")
    .map((key) => {
      const before = a[key] as number;
      const after = b[key] as number;
      return { key, a: before, b: after, delta: after - before };
    });
}

/** A/B results and the delta for one comparison surface. */
export function comparisonFixture(
  entries: Record<string, AnalysisEntry>,
  tool: string,
): ComparisonDto | null {
  const entry = analysisFixture(entries, tool);
  if (!entry) return null;
  const before = entry.result as unknown as Record<string, unknown>;

  let after: Record<string, unknown>;
  let diff: ComparisonDiffDto;

  if (Array.isArray(before.values)) {
    const values = before.values as (number | null)[];
    const bValues = values.map((value) => (value == null ? null : value - 2));
    const delta = values.map((value, i) => {
      const other = bValues[i];
      return value == null || other == null ? null : other - value;
    });
    after = { ...before, values: bValues };
    diff = {
      kind: "series",
      summary: "reference 2 dB lower",
      stats: stats(delta),
      times: before.times as number[],
      values: delta,
      a: values,
      b: bValues,
    };
  } else {
    after = Object.fromEntries(
      Object.entries(before).map(([key, value]) => [
        key,
        typeof value === "number" ? value * 0.9 : value,
      ]),
    );
    diff = {
      kind: "scalar",
      summary: "reference 10% lower",
      fields: fieldDeltas(before, after),
    };
  }

  return {
    tool: tool as ComparisonDto["tool"],
    a: {
      project: "Preview fixture",
      source: SOURCE,
      window: WINDOW,
      params: PARAMS,
      options: {},
      summary: entry.summary,
      result: entry.result,
    },
    b: {
      project: "Saved reference",
      source: SOURCE,
      window: WINDOW,
      params: PARAMS,
      options: {},
      summary: entry.summary,
      result: after as unknown as AnyAnalysisResult,
    },
    comparability: {
      aligned: true,
      alignment: {
        aDuration: FIXTURE_SECONDS,
        bDuration: FIXTURE_SECONDS,
        bOffset: 0,
        common: WINDOW,
      },
      overlap: WINDOW,
      mismatches: [],
      filtersDiffer: false,
    },
    diff,
    savedFingerprint: "preview-fixture",
  };
}
