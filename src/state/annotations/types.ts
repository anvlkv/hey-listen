import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { AnalyzerId } from "../analyzer";

/** The fields a new annotation is built from (see `createAnnotation` in `./mutations`). */
export interface AnnotationInput {
  timeSecs: number;
  range?: AnalysisWindow | null;
  tool?: AnalyzerId | null;
  title?: string | null;
  body?: string;
  /** Select the new annotation (default true). */
  select?: boolean;
}

/** The editable fields of an annotation (see `updateAnnotation` in `./mutations`). */
export interface AnnotationPatch {
  title?: string | null;
  body?: string;
  timeSecs?: number;
  range?: AnalysisWindow | null;
  tool?: AnalyzerId | null;
  recomputeValues?: boolean;
}
