import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { AnnotationValues } from "../../bindings/AnnotationValues";
import type { SummaryItem } from "../../bindings/SummaryItem";
import { analyzerById } from "../analyzer/lookup";
import type { AnalyzerId, AnyAnalysisResult } from "../analyzer/types";
import { valuesText } from "./format";

/**
 * The **pure** half of the annotation values snapshot (D-19): build `AnnotationValues`
 * from a result and the inputs it was computed with. Keeping it out of `./values.ts`
 * means a unit test can exercise the snapshot without loading the timeline store (and,
 * through it, the chart bus and `@dschz/solid-uplot`'s CSS).
 */
export interface SnapshotArgs {
  tool: AnalyzerId;
  result: AnyAnalysisResult;
  timeSecs: number;
  window: AnalysisWindow;
  params: AnnotationValues["params"];
  options: Record<string, number>;
  capturedMs: number;
  /** The live run's canonical summary items; `[]` when the result came from the cache. */
  summary: SummaryItem[];
}

/**
 * Build a `AnnotationValues` snapshot from a live result (the readout at the annotation's
 * time). Its `summary` items are the live run's canonical summary (D-19); a result adopted
 * from the project cache carries none, so the snapshot's items are then `[]`.
 */
export function annotationValuesFor(args: SnapshotArgs): AnnotationValues {
  const def = analyzerById(args.tool);
  return {
    tool: args.tool,
    label: `${def.title} @ ${args.timeSecs.toFixed(3)} s`,
    text: valuesText(def.id, args.result, args.timeSecs),
    window: args.window,
    params: args.params,
    options: args.options,
    capturedMs: args.capturedMs,
    summary: args.summary,
  };
}
