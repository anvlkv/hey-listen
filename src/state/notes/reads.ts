import type { Note } from "../../bindings/Note";
import { notes } from "./signals";

/** One note by id, or `null`. */
export function noteById(id: string | null): Note | null {
  if (!id) return null;
  return notes().find((note) => note.id === id) ?? null;
}

/** The notes sorted by anchor time. */
export function notesSorted(): Note[] {
  return [...notes()].sort((a, b) => a.timeSecs - b.timeSecs);
}
