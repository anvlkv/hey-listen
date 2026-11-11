import { expect, it } from "vitest";
import type { NoteMetric } from "../bindings/NoteMetric";
import type { NoteMetricsResult } from "../bindings/NoteMetricsResult";
import { gapAt, gapSpans, noteAt, segmentEnvelope } from "../lib/noteSegments";

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

it("empty result yields empty columns", () => {
  const data = segmentEnvelope(result([]));
  expect(data.xs.length).toBe(0);
  expect(data.levels.length).toBe(0);
  expect(data.f0.length).toBe(0);
});

it("one note spans its own envelope with no trailing break", () => {
  const data = segmentEnvelope(result([note(0, 1, [-20, -18, -22])]));
  // No leading/trailing silence: three samples only, x 0 · 0.5 · 1.
  expect(data.xs).toEqual([0, 0.5, 1]);
  expect(data.levels).toEqual([-20, -18, -22]);
  expect(data.f0).toEqual([null, null, null]);
});

it("the f0 summary spans the whole note and stops at the gap", () => {
  const data = segmentEnvelope(
    result([note(0, 0.5, [-20, -20, -20], 0, 0, 180), note(1, 1.5, [-20, -20, -20], 0, 0, 240)]),
  );
  expect(data.f0).toEqual([180, 180, 180, null, 240, 240, 240]);
});

it("leading and trailing silence are in the extent", () => {
  const data = segmentEnvelope(result([note(0.5, 1, [-20, -18, -22], 0.25, 0.25)], 0.25));
  expect(data.xs[0]).toBe(0.25);
  expect(data.xs[data.xs.length - 1]).toBe(1.25);
  expect(data.levels[0]).toBeNull();
  expect(data.levels[data.levels.length - 1]).toBeNull();
});

it("a gap inserts one null break point between notes", () => {
  const data = segmentEnvelope(
    result([note(0, 0.5, [-20, -20, -20]), note(1, 1.5, [-30, -30, -30])]),
  );
  // Note A 0 · 0.25 · 0.5, break at 0.75, note B 1 · 1.25 · 1.5.
  expect(data.xs).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
  expect(data.levels[3]).toBeNull();
  expect(data.levels[4]).toBe(-30);
  for (let i = 1; i < data.xs.length; i++) {
    expect(data.xs[i], `x values must ascend at ${i}`).toBeGreaterThan(data.xs[i - 1]);
  }
});

it("noteAt finds the containing note and reports gaps", () => {
  const notes = [note(0, 0.5, [-20]), note(1, 1.5, [-20])];
  expect(noteAt(notes, 0.2)?.index).toBe(0);
  expect(noteAt(notes, 1.5)?.index).toBe(1);
  expect(noteAt(notes, 0.75)).toBeNull();
  expect(noteAt(notes, 2)).toBeNull();
});

it("gapAt names leading, between, and trailing silence", () => {
  const value = result([note(0.5, 1, [-20], 0.5, 0.25), note(1.5, 2, [-20], 0.5, 0.25)], 0);
  expect(gapAt(value, 0.2)?.kind).toBe("leading");
  expect(gapAt(value, 1.25)?.kind).toBe("between");
  expect(gapAt(value, 1.25)?.durationSecs).toBe(0.5);
  expect(gapAt(value, 2.1)?.kind).toBe("trailing");
  expect(gapAt(value, 0.75)).toBeNull();
});

it("gapSpans lists every silence including the window edges", () => {
  const value = result([note(0.5, 1, [-20], 0.5, 0.5), note(1.5, 2, [-20], 0.5, 0.5)], 0);
  const spans = gapSpans(value);
  expect(spans.length).toBe(3);
  expect(spans[0].durationSecs).toBe(0.5);
  expect(spans[1].durationSecs).toBe(0.5);
  expect(spans[2].durationSecs).toBe(0.5);
});
