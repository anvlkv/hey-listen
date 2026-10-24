import type { NoteMetric } from "../bindings/NoteMetric";
import type { NoteMetricsResult } from "../bindings/NoteMetricsResult";

/**
 * Chart data for the **note segments** view (M18/M19 result): one column of times, one
 * column of levels (dBFS), and one column of per-note median f0 (Hz, on its own scale).
 * `null` separates notes so a line never joins two segments across a gap.
 *
 * These are the detected note segments, not the project's user-authored annotations
 * (M14) — see `docs/notes.md` → Terminology.
 */
export interface SegmentSeries {
  xs: number[];
  levels: (number | null)[];
  /** f0 is held flat across a note — a per-note summary, not a pitch track. */
  f0: (number | null)[];
}

/** A stretch of silence between (or before/after) the detected notes. */
export interface GapSpan {
  startSecs: number;
  endSecs: number;
  durationSecs: number;
  kind: "leading" | "between" | "trailing";
}

/** The note spanning `time` (source seconds), with its index in the result. */
export function noteAt(
  notes: readonly NoteMetric[],
  time: number,
): { note: NoteMetric; index: number } | null {
  const index = notes.findIndex((note) => time >= note.startSecs && time <= note.endSecs);
  return index < 0 ? null : { note: notes[index], index };
}

const gap = (startSecs: number, endSecs: number, kind: GapSpan["kind"]): GapSpan => ({
  startSecs,
  endSecs,
  durationSecs: Math.max(0, endSecs - startSecs),
  kind,
});

/**
 * The silence spanning `time`: the leading silence before the first note, the gap
 * between two notes, or the trailing silence after the last one. `null` when `time`
 * falls inside a note (or outside the result's window).
 */
export function gapAt(
  result: Pick<NoteMetricsResult, "windowStart" | "notes">,
  time: number,
): GapSpan | null {
  const notes = result.notes;
  if (notes.length === 0) return null;
  const first = notes[0];
  if (time >= result.windowStart && time < first.startSecs) {
    return gap(result.windowStart, first.startSecs, "leading");
  }
  for (let index = 0; index + 1 < notes.length; index++) {
    const current = notes[index];
    const next = notes[index + 1];
    if (time >= current.endSecs && time < next.startSecs) {
      return gap(current.endSecs, next.startSecs, "between");
    }
  }
  const last = notes[notes.length - 1];
  const windowEnd = last.endSecs + last.gapAfterSecs;
  if (time >= last.endSecs && time <= windowEnd) return gap(last.endSecs, windowEnd, "trailing");
  return null;
}

/** Every silence span in the result, including the window's leading/trailing edges. */
export function gapSpans(result: Pick<NoteMetricsResult, "windowStart" | "notes">): GapSpan[] {
  const notes = result.notes;
  const spans: GapSpan[] = [];
  if (notes.length === 0) return spans;
  const first = notes[0];
  if (result.windowStart < first.startSecs) {
    spans.push(gap(result.windowStart, first.startSecs, "leading"));
  }
  for (let index = 0; index + 1 < notes.length; index++) {
    const current = notes[index];
    const next = notes[index + 1];
    if (next.startSecs > current.endSecs) {
      spans.push(gap(current.endSecs, next.startSecs, "between"));
    }
  }
  const last = notes[notes.length - 1];
  const windowEnd = last.endSecs + last.gapAfterSecs;
  if (windowEnd > last.endSecs) spans.push(gap(last.endSecs, windowEnd, "trailing"));
  return spans;
}

/**
 * Build the note-segment chart's columns: each note's normalized envelope spread over
 * its own span, separated by a `null` break point in the middle of the following gap.
 * The window's leading and trailing silence stay in the x extent so "fit" frames the
 * whole analysis window (silence included) rather than only the first-to-last note.
 */
export function segmentEnvelope(result: NoteMetricsResult): SegmentSeries {
  const xs: number[] = [];
  const levels: (number | null)[] = [];
  const f0: (number | null)[] = [];
  const notes = result.notes;

  if (notes.length === 0) return { xs, levels, f0 };

  /** uPlot needs strictly ascending, unique x values — a duplicate corrupts the scale. */
  const push = (x: number, level: number | null) => {
    const last = xs.length > 0 ? xs[xs.length - 1] : null;
    if (last != null && x <= last) return;
    xs.push(x);
    levels.push(level);
    f0.push(null);
  };

  const first = notes[0];
  // `windowStart` is the analysis window's origin in source seconds; the leading
  // silence is only worth a column when there actually is some.
  if (result.windowStart < first.startSecs) push(result.windowStart, null);

  for (const [index, note] of notes.entries()) {
    const span = note.endSecs - note.startSecs;
    const count = note.envelopeDb.length;
    const firstPoint = xs.length;
    for (let point = 0; point < count; point++) {
      const position = result.envelopePositions[point] ?? (count > 1 ? point / (count - 1) : 0);
      push(note.startSecs + position * span, note.envelopeDb[point]);
    }
    // The f0 summary is drawn as a flat segment over the note. Every point carries
    // the value so the line is continuous within the note; the gaps stay `null` and
    // the series uses `spanGaps: false`, so it never joins two notes.
    if (note.f0MedianHz != null && xs.length > firstPoint) {
      for (let point = firstPoint; point < xs.length; point++) f0[point] = note.f0MedianHz;
    }

    const next = notes[index + 1];
    if (next) {
      if (next.startSecs > note.endSecs) push((note.endSecs + next.startSecs) / 2, null);
    } else {
      // `gapAfterSecs` on the last note is the window's trailing silence.
      const windowEnd = note.endSecs + note.gapAfterSecs;
      if (windowEnd > note.endSecs) push(windowEnd, null);
    }
  }

  return { xs, levels, f0 };
}
