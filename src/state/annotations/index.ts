/**
 * The annotations store (M14) — the project's annotation layer (see `docs/annotations.md`).
 *
 * An annotation is plain **data** (project content): a markdown body anchored to a time
 * (+ optional range) and, optionally, to an analyzer tool id, carrying a **frozen**
 * `values` snapshot of that chart's readout. The store owns create/update/delete/
 * selection and the values capture; persistence rides `save_project` / `load_project`
 * and cross-window sync rides `uiState` (ADR-11/ADR-18).
 *
 * The store also publishes its state on the shared chart bus (`annotations`), so a chart's
 * annotation plugin can draw its own annotations, the one selected annotation, and whether the rail is open.
 *
 * **Select vs. analyze.** Selecting an annotation ([`selectAnnotation`]) only highlights it and opens
 * its chart; only [`analyzeAnnotation`] (the row's Analyze button) moves the analysis window.
 *
 * This module is the package's public surface — it re-exports the store's API, so
 * importers need no changes. The parts live in focused siblings: `types` (input
 * shapes), `signals` (the store signals + bus publish), `reads` (queries),
 * `mutations` (create/update/delete/patch), `select` (selection/analyze), `values`
 * (frozen readout snapshots) and `format` (the per-tool readout line).
 */
export {
  editingAnnotationId,
  selectedAnnotationId,
  annotations,
  setEditingAnnotationId,
  setSelectedAnnotationId,
} from "./signals";
export { annotationById, annotationsSorted } from "./reads";
export {
  createAnnotation,
  deleteAnnotation,
  dragAnnotationEndTo,
  dragAnnotationTo,
  refreshAnnotationValues,
  replaceAnnotations,
  resetAnnotations,
  updateAnnotation,
} from "./mutations";
export {
  analyzeAnnotation,
  defaultAnnotationTool,
  selectAnnotation,
  setSelectedAnnotation,
} from "./select";
export { liveValues, annotationValuesStale } from "./values";
export { openAnnotationWindow } from "./window";
export type { AnnotationPatch } from "./types";
