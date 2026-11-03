import type { Annotation } from "../../bindings/Annotation";
import { isAnalyzerId, type AnalyzerId } from "../analyzer";
import { clampAnnotationTime } from "../../lib/annotation";
import { source } from "../source";
import { setWindowEnd, setWindowStart, windowEnd, windowStart } from "../timeline";
import { focusedAnalyzer, openTool } from "../workbench";
import { annotationById } from "./reads";
import { setSelectedAnnotationId } from "./signals";

/** Set the selection without side effects (cross-window sync + the MCP tool). */
export function setSelectedAnnotation(id: string | null) {
  setSelectedAnnotationId(id);
}

/**
 * Select an annotation from the UI: highlight it and open (or raise) the chart it belongs to.
 *
 * Selecting **never** moves the analysis window — an annotation is an annotation *on* the
 * analysis, so neither creating one nor clicking one is a request to reframe. Moving
 * the window onto an annotation is the explicit [`analyzeAnnotation`] action (the row's **Analyze**
 * button). See `docs/annotations.md` → Surfacing.
 */
export function selectAnnotation(id: string | null) {
  setSelectedAnnotationId(id);
  const annotation = annotationById(id);
  if (annotation?.tool && isAnalyzerId(annotation.tool)) void openTool(annotation.tool);
}

/**
 * The **only** action that moves the analysis window onto an annotation: the row's Analyze
 * button. A range annotation becomes the window exactly; a point annotation gets a window of the
 * current width (or a tenth of the source) starting at its time.
 */
export function analyzeAnnotation(id: string | null) {
  selectAnnotation(id);
  const annotation = annotationById(id);
  if (!annotation) return;
  applyAnnotationWindow(annotation);
}

/** Move the analysis window onto an annotation (its span, or a window starting at its time). */
function applyAnnotationWindow(annotation: Annotation) {
  const duration = source()?.duration ?? 0;
  if (annotation.range) {
    setWindowStart(annotation.range.startSecs);
    setWindowEnd(annotation.range.endSecs);
    return;
  }
  const width = windowEnd() - windowStart();
  const start = clampAnnotationTime(annotation.timeSecs, duration);
  const fallback = duration > 0 ? Math.max(0.05, duration * 0.1) : 0;
  const end = duration > 0 ? Math.min(duration, start + (width > 0 ? width : fallback)) : start;
  setWindowStart(start);
  setWindowEnd(Math.max(end, start));
}

/** The focused analyzer tab, for the panel's "Add annotation" default tool. */
export function defaultAnnotationTool(): AnalyzerId | null {
  return focusedAnalyzer();
}
