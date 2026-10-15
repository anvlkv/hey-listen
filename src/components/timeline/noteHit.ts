import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { notesSorted } from "../../state/notes";
import { noteLabel, noteTimeText } from "../../lib/note";
import { NOTE_HIT } from "./constants";
import type { Note } from "../../bindings/Note";

/**
 * Note-anchor hit-testing and hover text for the Timeline canvas (M14). Pure helpers:
 * `noteAt` takes the same `t2x` projection the canvas draws with, so a click lands on
 * the anchor the user sees. The anchors sit in the bottom **strip** (see
 * `components/notes/strip.ts`), clear of the window move handle at the top.
 * See `docs/notes.md` → Surfacing.
 */

/** The note anchor under a pointer position in the bottom strip, or `null`. */
export function noteAt(
  x: number,
  y: number,
  t2x: (t: number) => number,
  stripTop: number,
): Note | null {
  if (y < stripTop) return null;
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
