import { analyzerById, isAnalyzerId } from "../../state/analyzer";
import { notesSorted } from "../../state/notes";
import { noteLabel, noteSpan, noteTimeText } from "../../lib/note";
import { NOTE_HIT } from "./constants";
import type { Note } from "../../bindings/Note";

/**
 * Note-anchor hit-testing and hover text for the Timeline canvas (M14). Pure helpers:
 * `noteEdgeAt` takes the same `t2x` projection the canvas draws with, so a click lands
 * on the handle the user sees. The anchors sit in the bottom **strip** (see
 * `components/notes/strip.ts`), clear of the window move handle at the top.
 * See `docs/notes.md` → Surfacing.
 */

/** Which edge of a note's anchor a pointer grabbed. */
export type NoteEdge = "start" | "end";

/** The note handle under a pointer position in the bottom strip, or `null`. */
export function noteEdgeAt(
  x: number,
  y: number,
  t2x: (t: number) => number,
  stripTop: number,
): { note: Note; edge: NoteEdge } | null {
  if (y < stripTop) return null;
  let best: { note: Note; edge: NoteEdge } | null = null;
  let bestDistance = NOTE_HIT;
  for (const note of notesSorted()) {
    const span = noteSpan(note);
    // A range has two handles (its span is resizable from either side); a point note
    // has only its anchor, which is dragged to move the note.
    const edges: NoteEdge[] = span.end > span.start ? ["start", "end"] : ["start"];
    for (const edge of edges) {
      const distance = Math.abs(t2x(edge === "end" ? span.end : span.start) - x);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { note, edge };
      }
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
