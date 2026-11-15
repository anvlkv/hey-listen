import type { Annotation } from "../../bindings/Annotation";
import { isAnalyzerId, type AnalyzerId } from "../analyzer";
import { clampAnnotationTime } from "../../lib/annotation";
import { source } from "../source";
import { setWindowEnd, setWindowStart } from "../timeline";
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
 * button. A range annotation becomes the window exactly; a point annotation gets a short
 * window **centred** on its time.
 */
export function analyzeAnnotation(id: string | null) {
  selectAnnotation(id);
  const annotation = annotationById(id);
  if (!annotation) return;
  applyAnnotationWindow(annotation);
}

/** The short analysis window a point annotation is analysed in (seconds). */
const MOMENT_WINDOW_S = 0.5;

/** Move the analysis window onto an annotation: its span, or a short window centred on a point. */
function applyAnnotationWindow(annotation: Annotation) {
  const duration = source()?.duration ?? 0;
  if (annotation.range) {
    setWindowStart(annotation.range.startSecs);
    setWindowEnd(annotation.range.endSecs);
    return;
  }
  // A point gets a short window **centred** on it, so the moment sits mid-fragment with
  // context on both sides; near an edge the window keeps its width and slides inward.
  const center = clampAnnotationTime(annotation.timeSecs, duration);
  if (!(duration > 0)) {
    setWindowStart(center);
    setWindowEnd(center);
    return;
  }
  const width = Math.min(duration, MOMENT_WINDOW_S);
  let start = center - width / 2;
  let end = center + width / 2;
  if (start < 0) {
    end -= start;
    start = 0;
  } else if (end > duration) {
    start -= end - duration;
    end = duration;
  }
  setWindowStart(Math.max(0, start));
  setWindowEnd(end);
}

/** The focused analyzer tab, for the panel's "Add annotation" default tool. */
export function defaultAnnotationTool(): AnalyzerId | null {
  return focusedAnalyzer();
}
