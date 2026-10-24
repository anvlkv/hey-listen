import type { NoteMetric } from "../src/bindings/NoteMetric";
import type { NoteMetricsResult } from "../src/bindings/NoteMetricsResult";
import { gapAt, gapSpans, noteAt, segmentEnvelope } from "../src/lib/noteSegments";
import { assertEqual, check, report } from "./testHarness";

/**
 * Unit checks for the note-segments chart data (`src/lib/noteSegments.ts`), runnable
 * without a browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * The chart is built client-side from an M18/M19 `noteMetrics` result, so the columns
 * must satisfy uPlot's data model (strictly ascending, unique x; one `null` break
 * point per gap), the f0 summary must be present only where a note has a median, and
 * the gap spans must match the engine's leading/between/trailing silence.
 */

const POSITIONS = [0, 0.5, 1];

function note(
  start: number,
  end: number,
  envelope: number[],
  gapBefore = 0,
  gapAfter = 0,
  f0: number | null = null,
): NoteMetric {
  return {
    startSecs: start,
    endSecs: end,
    durationSecs: end - start,
    gapBeforeSecs: gapBefore,
    gapAfterSecs: gapAfter,
    rmsDb: -20,
    peakDb: -10,
    rmsDbRelLoudest: 0,
    peakDbRelLoudest: 0,
    envelopeDb: envelope,
    voicedFraction: null,
    f0MedianHz: f0,
    jitterProxyCents: null,
    shimmerProxyDb: null,
    hnrProxy: null,
  };
}

function result(notes: NoteMetric[], windowStart = 0): NoteMetricsResult {
  return {
    windowStart,
    noteCount: notes.length,
    gapCount: Math.max(0, notes.length - 1),
    totalGapSecs: 0,
    longestGapSecs: 0,
    medianNoteSecs: 0,
    medianGapSecs: 0,
    thresholdDb: -40,
    envelopePositions: POSITIONS,
    referenceNoteIndex: notes.length > 0 ? 0 : null,
    notes,
    gaps: [],
  };
}

check("empty result yields empty columns", () => {
  const data = segmentEnvelope(result([]));
  assertEqual(data.xs.length, 0);
  assertEqual(data.levels.length, 0);
  assertEqual(data.f0.length, 0);
});

check("one note spans its own envelope with no trailing break", () => {
  const data = segmentEnvelope(result([note(0, 1, [-20, -18, -22])]));
  // No leading/trailing silence: three samples only, x 0 · 0.5 · 1.
  assertEqual(JSON.stringify(data.xs), JSON.stringify([0, 0.5, 1]));
  assertEqual(JSON.stringify(data.levels), JSON.stringify([-20, -18, -22]));
  assertEqual(JSON.stringify(data.f0), JSON.stringify([null, null, null]));
});

check("the f0 summary spans the whole note and stops at the gap", () => {
  const data = segmentEnvelope(
    result([note(0, 0.5, [-20, -20, -20], 0, 0, 180), note(1, 1.5, [-20, -20, -20], 0, 0, 240)]),
  );
  assertEqual(JSON.stringify(data.f0), JSON.stringify([180, 180, 180, null, 240, 240, 240]));
});

check("leading and trailing silence are in the extent", () => {
  const data = segmentEnvelope(result([note(0.5, 1, [-20, -18, -22], 0.25, 0.25)], 0.25));
  assertEqual(data.xs[0], 0.25);
  assertEqual(data.xs[data.xs.length - 1], 1.25);
  assertEqual(data.levels[0], null);
  assertEqual(data.levels[data.levels.length - 1], null);
});

check("a gap inserts one null break point between notes", () => {
  const data = segmentEnvelope(
    result([note(0, 0.5, [-20, -20, -20]), note(1, 1.5, [-30, -30, -30])]),
  );
  // Note A 0 · 0.25 · 0.5, break at 0.75, note B 1 · 1.25 · 1.5.
  assertEqual(JSON.stringify(data.xs), JSON.stringify([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]));
  assertEqual(data.levels[3], null);
  assertEqual(data.levels[4], -30);
  for (let i = 1; i < data.xs.length; i++) {
    if (!(data.xs[i] > data.xs[i - 1])) throw new Error(`x values must ascend at ${i}`);
  }
});

check("noteAt finds the containing note and reports gaps", () => {
  const notes = [note(0, 0.5, [-20]), note(1, 1.5, [-20])];
  assertEqual(noteAt(notes, 0.2)?.index, 0);
  assertEqual(noteAt(notes, 1.5)?.index, 1);
  assertEqual(noteAt(notes, 0.75), null);
  assertEqual(noteAt(notes, 2), null);
});

check("gapAt names leading, between, and trailing silence", () => {
  const value = result([note(0.5, 1, [-20], 0.5, 0.25), note(1.5, 2, [-20], 0.5, 0.25)], 0);
  assertEqual(gapAt(value, 0.2)?.kind, "leading");
  assertEqual(gapAt(value, 1.25)?.kind, "between");
  assertEqual(gapAt(value, 1.25)?.durationSecs, 0.5);
  assertEqual(gapAt(value, 2.1)?.kind, "trailing");
  assertEqual(gapAt(value, 0.75), null);
});

check("gapSpans lists every silence including the window edges", () => {
  const value = result([note(0.5, 1, [-20], 0.5, 0.5), note(1.5, 2, [-20], 0.5, 0.5)], 0);
  const spans = gapSpans(value);
  assertEqual(spans.length, 3);
  assertEqual(spans[0].durationSecs, 0.5);
  assertEqual(spans[1].durationSecs, 0.5);
  assertEqual(spans[2].durationSecs, 0.5);
});

report("noteSegments");
