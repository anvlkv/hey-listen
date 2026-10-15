import type { AnalysisWindow } from "../bindings/AnalysisWindow";
import type { Note } from "../bindings/Note";
import type { NoteValues } from "../bindings/NoteValues";

/**
 * Pure helpers for the note model (M14): clamping, labels, excerpts, and the
 * "is the frozen snapshot stale" comparison. Kept free of stores/Tauri so they can
 * be unit-tested with `npm run test:unit` (see `scripts/notes.test.ts`); the store
 * itself lives in `state/notes/`. See `docs/notes.md`.
 */

/** Longest body excerpt used when a note has no title. */
export const NOTE_EXCERPT_LEN = 60;

/** The shortest span a range note can hold, in seconds (a drag cannot collapse it). */
export const MIN_NOTE_RANGE = 0.001;

/** Clamp an anchor time to `[0, duration]` (a non-positive duration clamps to `0`). */
export function clampNoteTime(timeSecs: number, duration: number): number {
  if (!Number.isFinite(timeSecs)) return 0;
  if (!(duration > 0)) return Math.max(0, timeSecs);
  return Math.min(Math.max(0, timeSecs), duration);
}

/**
 * Order and clamp a span to `[0, duration]`. Returns `null` when the span collapses
 * (so a degenerate range becomes a point note rather than an empty span).
 */
export function clampNoteRange(range: AnalysisWindow, duration: number): AnalysisWindow | null {
  let a = range.startSecs;
  let b = range.endSecs;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a > b) [a, b] = [b, a];
  if (duration > 0) {
    a = Math.min(Math.max(0, a), duration);
    b = Math.min(Math.max(0, b), duration);
  } else {
    a = Math.max(0, a);
    b = Math.max(0, b);
  }
  return b > a ? { startSecs: a, endSecs: b } : null;
}

/** A one-line excerpt of a markdown body: the first non-empty line, ellipsised. */
export function noteExcerpt(body: string, max = NOTE_EXCERPT_LEN): string {
  const line = body
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return "";
  const short: string[] = Array.from(line);
  return short.length > max ? `${short.slice(0, max).join("")}…` : line;
}

/**
 * The note's display heading, derived from the body: its first non-empty line with the
 * common markdown markers stripped (`#`, `>`, list bullets, links, emphasis). There is
 * no separate title field — the first line of the markdown *is* the title.
 */
export function noteHeading(body: string, max = NOTE_EXCERPT_LEN): string {
  const line = body
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return "";
  const plain = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .trim();
  const text = plain || line;
  const chars: string[] = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

/** The row/marker label: the body's heading, else "Note". */
export function noteLabel(note: Pick<Note, "title" | "body">): string {
  return noteHeading(note.body) || "Note";
}

/**
 * The note body **without** its heading line — what to render under the title, so the
 * first line (shown as the title) is not repeated in the rendered markdown.
 */
export function noteBody(body: string): string {
  const lines = body.split("\n");
  const heading = lines.findIndex((line) => line.trim().length > 0);
  if (heading < 0) return "";
  return lines
    .slice(heading + 1)
    .join("\n")
    .trim();
}

/**
 * The span a note's markers occupy: its `range`, else its point anchor
 * (`start === end`). Everything that draws or grabs a note's edges goes through this,
 * so a note is a point until it has a range and a two-edged selection once it does.
 */
export function noteSpan(note: Pick<Note, "timeSecs" | "range">): { start: number; end: number } {
  const range = note.range;
  return range
    ? { start: range.startSecs, end: range.endSecs }
    : { start: note.timeSecs, end: note.timeSecs };
}

/**
 * Clamp a dragged range **end** to the source, keeping at least [`MIN_NOTE_RANGE`]
 * after `start` — dragging the end onto the start must not collapse the range (a
 * collapsed range is not a note any more, it is a point).
 */
export function clampNoteRangeEnd(start: number, end: number, duration: number): number {
  const lo = start + MIN_NOTE_RANGE;
  const hi = duration > 0 ? Math.max(duration, lo) : Math.max(end, lo);
  return Math.min(Math.max(end, lo), hi);
}

/** Clamp a dragged range **start**: never before 0, never onto its own end. */
export function clampNoteRangeStart(start: number, end: number): number {
  return Math.max(0, Math.min(start, end - MIN_NOTE_RANGE));
}

/** `"2.340 s"` (or `"1.000 – 1.500 s"` for a range) — the note's time subtitle. */
export function noteTimeText(note: Pick<Note, "timeSecs" | "range">): string {
  const range = note.range;
  if (range) return `${range.startSecs.toFixed(3)} – ${range.endSecs.toFixed(3)} s`;
  return `${note.timeSecs.toFixed(3)} s`;
}

/**
 * The frame of a uniformly-sampled window grid that contains `timeSecs`.
 *
 * A tool's frames are evenly spaced across the analysis window, and every time a
 * result carries is in **source seconds** (see `docs/analysis-tools.md`), so reading
 * the frame at a note's time needs the window's origin — this is that lookup. Clamped
 * to the grid, so a time outside the window reads its nearest edge frame.
 */
export function noteFrameAt(
  timeSecs: number,
  windowStartSecs: number,
  durationSecs: number,
  frames: number,
): number {
  if (!(durationSecs > 0) || frames <= 0) return 0;
  const into = (timeSecs - windowStartSecs) / durationSecs;
  return Math.min(frames - 1, Math.max(0, Math.floor(into * frames)));
}

/** Compare a window / params / options / text snapshot by value (for the stale hint). */
export function valuesEqual(a: NoteValues | null, b: NoteValues | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return (
    a.text === b.text &&
    a.window.startSecs === b.window.startSecs &&
    a.window.endSecs === b.window.endSecs &&
    JSON.stringify(a.params) === JSON.stringify(b.params) &&
    JSON.stringify(a.options) === JSON.stringify(b.options)
  );
}
