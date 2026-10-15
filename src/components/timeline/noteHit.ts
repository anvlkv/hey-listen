import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { notesSorted } from "../../state/notes";
import { noteLabel, noteTimeText } from "../../lib/note";
import { NOTE_BAND, NOTE_HIT, RULER_H } from "./constants";
import type { Note } from "../../bindings/Note";

/**
 * Note-pin hit-testing and hover text for the Timeline canvas (M14). Pure helpers:
 * `noteAt` takes the same `t2x` projection the canvas draws with, so a click lands
 * on the pin the user sees. See `docs/notes.md` → Surfacing.
 */

/** The note pin under a pointer position, or `null`. */
export function noteAt(x: number, y: number, t2x: (t: number) => number): Note | null {
  if (y < RULER_H || y > RULER_H + NOTE_BAND) return null;
  let best: Note | null = null;
  let bestDistance = NOTE_HIT;
  for (const note of notesSorted()) {
    const distance = Math.abs(t2x(note.timeSecs) - x);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = note;
    }
  }
  return best;
}

/** The hover hint text for a note (title · tool · time · values line). */
export function noteHintText(note: Note): string {
  const tool = note.tool && isAnalyzerId(note.tool) ? analyzerById(note.tool).title : "Timeline";
  const values = note.values ? ` · ${note.values.text}` : "";
  return `${noteLabel(note)} · ${tool} · ${noteTimeText(note)}${values}`;
}
