import type { Annotation } from "../../bindings/Annotation";
import { isAnalyzerId, type AnalyzerId } from "../analyzer";
import {
  clampAnnotationRange,
  clampAnnotationRangeEnd,
  clampAnnotationRangeStart,
  clampAnnotationTime,
  annotationSpan,
} from "../../lib/annotation";
import { setAnnotationsPanelOpen } from "../settings";
import { source } from "../source";
import { selectAnnotation } from "./select";
import { annotationById } from "./reads";
import {
  editingAnnotationId,
  selectedAnnotationId,
  setEditingAnnotationId,
  setSelectedAnnotationId,
  setAnnotations,
} from "./signals";
import type { AnnotationInput, AnnotationPatch } from "./types";
import { captureValues } from "./values";

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `annotation-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Normalise an incoming annotation: validate the tool, clamp the time/range. */
function normalize(annotation: Annotation): Annotation {
  const duration = source()?.duration ?? 0;
  const tool = annotation.tool && isAnalyzerId(annotation.tool) ? annotation.tool : null;
  return {
    ...annotation,
    timeSecs: clampAnnotationTime(annotation.timeSecs, duration),
    range: annotation.range ? clampAnnotationRange(annotation.range, duration) : null,
    tool,
  };
}

/** Create an annotation (capturing its values snapshot) and select it. */
export function createAnnotation(input: AnnotationInput): Annotation {
  const now = Date.now();
  const tool = input.tool && isAnalyzerId(input.tool) ? input.tool : null;
  const annotation = normalize({
    id: newId(),
    createdMs: now,
    updatedMs: now,
    timeSecs: input.timeSecs,
    range: input.range ?? null,
    tool,
    title: input.title ?? null,
    body: input.body ?? "",
    values: null,
  });
  annotation.values = tool ? captureValues(tool, annotation.timeSecs, now) : null;
  setAnnotations((prev) => [...prev, annotation]);
  if (input.select ?? true) {
    // Creating reveals the rail (if collapsed), opens the new annotation's editor and selects
    // it. It deliberately does **not** move the analysis window: adding an annotation
    // must not reframe the analysis (see `docs/annotations.md` → Surfacing).
    setAnnotationsPanelOpen(true);
    setEditingAnnotationId(annotation.id);
    selectAnnotation(annotation.id);
  }
  return annotation;
}

/** Patch an annotation's editable fields (and optionally refresh its values snapshot). */
export function updateAnnotation(id: string, patch: AnnotationPatch): Annotation | null {
  let updated: Annotation | null = null;
  setAnnotations((prev) =>
    prev.map((annotation) => {
      if (annotation.id !== id) return annotation;
      const next = normalize({
        ...annotation,
        title: "title" in patch ? (patch.title ?? null) : annotation.title,
        body: patch.body ?? annotation.body,
        timeSecs: patch.timeSecs ?? annotation.timeSecs,
        range: "range" in patch ? (patch.range ?? null) : annotation.range,
        tool: "tool" in patch ? (patch.tool ?? null) : (annotation.tool as AnalyzerId | null),
      });
      next.updatedMs = Date.now();
      if (patch.recomputeValues && next.tool && isAnalyzerId(next.tool)) {
        next.values = captureValues(next.tool, next.timeSecs, Date.now());
      }
      updated = next;
      return next;
    }),
  );
  return updated;
}

/** Remove an annotation; clearing the selection/editing if it was this annotation. */
export function deleteAnnotation(id: string) {
  setAnnotations((prev) => prev.filter((annotation) => annotation.id !== id));
  if (selectedAnnotationId() === id) setSelectedAnnotationId(null);
  if (editingAnnotationId() === id) setEditingAnnotationId(null);
}

/** Re-snapshot an annotation's frozen values from the live chart. */
export function refreshAnnotationValues(id: string) {
  updateAnnotation(id, { recomputeValues: true });
}

/**
 * Live drag of an annotation's **start** edge (clamped to the source), along the time axis.
 *
 * A point annotation moves; a range annotation **resizes** — its start follows the pointer and its
 * end stays put (the selection semantics the strip's two handles imply). Call
 * [`refreshAnnotationValues`] on release to re-snapshot the values at the new start.
 */
export function dragAnnotationTo(id: string, timeSecs: number) {
  const duration = source()?.duration ?? 0;
  const annotation = annotationById(id);
  if (!annotation) return;
  const range = annotation.range;
  if (!range) {
    updateAnnotation(id, { timeSecs: clampAnnotationTime(timeSecs, duration) });
    return;
  }
  const start = clampAnnotationRangeStart(clampAnnotationTime(timeSecs, duration), range.endSecs);
  updateAnnotation(id, { timeSecs: start, range: { startSecs: start, endSecs: range.endSecs } });
}

/**
 * Live drag of a range's **end** edge, clamped to the source (the span never
 * collapses). A point annotation grows a range from its anchor, which is how a range is
 * made by dragging. Call [`refreshAnnotationValues`] on release.
 */
export function dragAnnotationEndTo(id: string, timeSecs: number) {
  const duration = source()?.duration ?? 0;
  const annotation = annotationById(id);
  if (!annotation) return;
  const start = annotationSpan(annotation).start;
  const end = clampAnnotationRangeEnd(start, timeSecs, duration);
  updateAnnotation(id, { range: { startSecs: start, endSecs: end } });
}

/** Replace the whole list (load / undo / cross-window sync), pruning stale selections. */
export function replaceAnnotations(list: Annotation[]) {
  const normalized = list.map(normalize);
  setAnnotations(normalized);
  const selected = selectedAnnotationId();
  if (selected && !normalized.some((annotation) => annotation.id === selected))
    setSelectedAnnotationId(null);
  const editing = editingAnnotationId();
  if (editing && !normalized.some((annotation) => annotation.id === editing))
    setEditingAnnotationId(null);
}

/** Drop every annotation and the selection (New Project). */
export function resetAnnotations() {
  setAnnotations([]);
  setSelectedAnnotationId(null);
  setEditingAnnotationId(null);
}
