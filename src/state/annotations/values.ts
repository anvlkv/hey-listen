import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { Annotation } from "../../bindings/Annotation";
import type { AnnotationValues } from "../../bindings/AnnotationValues";
import {
  analyzerById,
  isAnalyzerId,
  latestResult,
  toolOptions,
  type AnalyzerId,
  type AnyAnalysisResult,
} from "../analyzer";
import { sharedParams } from "../analysis";
import { windowEnd, windowStart } from "../timeline";
import { valuesText } from "./format";

/** The frozen snapshot for a tool's chart at `timeSecs`, or `null` without a result. */
export function captureValues(
  tool: AnalyzerId,
  timeSecs: number,
  capturedMs: number,
): AnnotationValues | null {
  const result = latestResult(tool);
  return result ? snapshot(tool, result, timeSecs, capturedMs) : null;
}

/** Build a `AnnotationValues` snapshot from a live result (the readout at the annotation's time). */
export function annotationValuesFor(args: {
  tool: AnalyzerId;
  result: AnyAnalysisResult;
  timeSecs: number;
  window: AnalysisWindow;
  params: AnnotationValues["params"];
  options: Record<string, number>;
  capturedMs: number;
}): AnnotationValues {
  const def = analyzerById(args.tool);
  return {
    tool: args.tool,
    label: `${def.title} @ ${args.timeSecs.toFixed(3)} s`,
    text: valuesText(def.id, args.result, args.timeSecs),
    window: args.window,
    params: args.params,
    options: args.options,
    capturedMs: args.capturedMs,
  };
}

/** The frozen snapshot's **current** readout (live from the chart), or `null`. */
export function liveValues(annotation: Annotation): AnnotationValues | null {
  if (!annotation.tool || !isAnalyzerId(annotation.tool)) return null;
  // An annotation anchored outside the current window has no *current* readout — the chart
  // cannot show that time at all, so the row falls back to the frozen snapshot alone.
  if (annotation.timeSecs < windowStart() || annotation.timeSecs > windowEnd()) return null;
  const tool = annotation.tool;
  const result = latestResult(tool);
  return result
    ? snapshot(tool, result, annotation.timeSecs, annotation.values?.capturedMs ?? Date.now())
    : null;
}

/**
 * Build a snapshot, catching a formatter failure so it can never escape into the annotation
 * store. Both the capture path (creating / editing an annotation) and the live-readout path
 * (the row's values line) route through here: the snapshot is a *subtitle*, so losing
 * it must never cost the user their annotation or blank the rail.
 */
function snapshot(
  tool: AnalyzerId,
  result: AnyAnalysisResult,
  timeSecs: number,
  capturedMs: number,
): AnnotationValues | null {
  try {
    return annotationValuesFor({
      tool,
      result,
      timeSecs,
      window: { startSecs: windowStart(), endSecs: windowEnd() },
      params: sharedParams(),
      options: { ...toolOptions[tool] },
      capturedMs,
    });
  } catch (err) {
    console.error(`could not read ${tool}'s values at ${timeSecs} s`, err);
    return null;
  }
}

/** True when the live readout's **values line** differs from the frozen snapshot. */
export function annotationValuesStale(annotation: Annotation): boolean {
  if (!annotation.values) return false;
  const live = liveValues(annotation);
  return live != null && live.text !== annotation.values.text;
}
