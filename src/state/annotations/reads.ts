import type { Annotation } from "../../bindings/Annotation";
import { annotations } from "./signals";

/** One annotation by id, or `null`. */
export function annotationById(id: string | null): Annotation | null {
  if (!id) return null;
  return annotations().find((annotation) => annotation.id === id) ?? null;
}

/** The annotations sorted by anchor time. */
export function annotationsSorted(): Annotation[] {
  return [...annotations()].sort((a, b) => a.timeSecs - b.timeSecs);
}
