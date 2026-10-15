import type { AnalysisWindow } from "../../bindings/AnalysisWindow";
import type { AnalyzerId } from "../analyzer";

/** The fields a new note is built from (see `createNote` in `./mutations`). */
export interface NoteInput {
  timeSecs: number;
  range?: AnalysisWindow | null;
  tool?: AnalyzerId | null;
  title?: string | null;
  body?: string;
  /** Focus the new note (default true). */
  focus?: boolean;
}

/** The editable fields of a note (see `updateNote` in `./mutations`). */
export interface NotePatch {
  title?: string | null;
  body?: string;
  timeSecs?: number;
  range?: AnalysisWindow | null;
  tool?: AnalyzerId | null;
  recomputeValues?: boolean;
}
