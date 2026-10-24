import {
  clampNoteRange,
  clampNoteRangeEnd,
  clampNoteRangeStart,
  clampNoteTime,
  noteBody,
  noteExcerpt,
  noteFrameAt,
  noteHeading,
  noteLabel,
  noteSpan,
  noteTimeText,
  valuesEqual,
} from "../src/lib/note";
import type { NoteValues } from "../src/bindings/NoteValues";
// The *app's* result types, not the bindings': the runner tags every result with the
// tool it came from (`tool`), and `valuesText` dispatches on it.
import type { MatrixResult, NoteMetricsResult, SeriesResult } from "../src/state/analyzer/types";
import { valuesText } from "../src/state/notes/format";
import { assertDeepEqual, assertEqual, check, report } from "./testHarness";

/**
 * Unit checks for the note helpers (`src/lib/note.ts`), runnable without a browser or
 * Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * Covers the pure contract the notes store relies on: time/range clamping, the row
 * label + excerpt, the time subtitle, and the snapshot comparison behind the stale
 * hint. See `docs/notes.md`.
 */

check("clamps the anchor time to the source", () => {
  assertEqual(clampNoteTime(2.5, 4), 2.5);
  assertEqual(clampNoteTime(-1, 4), 0);
  assertEqual(clampNoteTime(9, 4), 4);
  // No source: only the lower bound applies.
  assertEqual(clampNoteTime(9, 0), 9);
  assertEqual(clampNoteTime(-3, 0), 0);
});

check("orders and clamps a range, collapsing a degenerate span", () => {
  assertDeepEqual(clampNoteRange({ startSecs: 3, endSecs: 1 }, 4), { startSecs: 1, endSecs: 3 });
  assertDeepEqual(clampNoteRange({ startSecs: -1, endSecs: 9 }, 4), { startSecs: 0, endSecs: 4 });
  assertEqual(clampNoteRange({ startSecs: 2, endSecs: 2 }, 4), null);
});

check("excerpts the first non-empty line, ellipsised", () => {
  assertEqual(noteExcerpt("\n  First line  \nsecond"), "First line");
  assertEqual(noteExcerpt(""), "");
  const long = "x".repeat(80);
  assertEqual(noteExcerpt(long, 10), `${"x".repeat(10)}…`);
  assertEqual(noteExcerpt(long, 10).endsWith("…"), true);
});

check("derives the heading from the body's first line (markdown stripped)", () => {
  assertEqual(noteHeading("Third harmonic\npeak at 880 Hz"), "Third harmonic");
  assertEqual(noteHeading("# Third harmonic\n\nmore"), "Third harmonic");
  assertEqual(noteHeading("- item one\n- item two"), "item one");
  assertEqual(noteHeading("[880 Hz](http://x) peak"), "880 Hz peak");
  assertEqual(noteHeading("**Bold** and `code`"), "Bold and code");
  assertEqual(noteHeading("   \n  "), "");
  assertEqual(noteHeading("x".repeat(80), 10), `${"x".repeat(10)}…`);
});

check("labels a note from its body heading (no separate title)", () => {
  assertEqual(noteLabel({ title: "ignored", body: "Third harmonic" }), "Third harmonic");
  assertEqual(noteLabel({ title: null, body: "   " }), "Note");
});

check("drops the heading line from the rendered body", () => {
  assertEqual(noteBody("Third harmonic\n\nPeak at 880 Hz."), "Peak at 880 Hz.");
  assertEqual(noteBody("# Third harmonic\n- a\n- b"), "- a\n- b");
  assertEqual(noteBody("Only a title"), "");
  assertEqual(noteBody("   \n  "), "");
});

check("formats a point and a range time subtitle", () => {
  assertEqual(noteTimeText({ timeSecs: 2.34, range: null }), "2.340 s");
  assertEqual(
    noteTimeText({ timeSecs: 2.34, range: { startSecs: 2.34, endSecs: 3.1 } }),
    "2.340 – 3.100 s",
  );
});

check("spans a point note at its anchor and a range note across its range", () => {
  assertDeepEqual(noteSpan({ timeSecs: 2, range: null }), { start: 2, end: 2 });
  assertDeepEqual(noteSpan({ timeSecs: 2, range: { startSecs: 1.5, endSecs: 3 } }), {
    start: 1.5,
    end: 3,
  });
});

check("clamps a dragged range end so the span never collapses", () => {
  // Inside the source: kept as-is.
  assertEqual(clampNoteRangeEnd(1, 2, 4), 2);
  // Past the source end: clamped to it.
  assertEqual(clampNoteRangeEnd(1, 9, 4), 4);
  // Dragged onto (or past) the start: kept a hairline away, never collapsed.
  assertEqual(clampNoteRangeEnd(1, 1, 4), 1.001);
  assertEqual(clampNoteRangeEnd(1, 0.5, 4), 1.001);
  // Unknown source duration: only the lower bound applies.
  assertEqual(clampNoteRangeEnd(1, 3, 0), 3);
  assertEqual(clampNoteRangeEnd(1, 0, 0), 1.001);
});

check("clamps a dragged range start inside the span", () => {
  assertEqual(clampNoteRangeStart(1, 3), 1);
  assertEqual(clampNoteRangeStart(-2, 3), 0);
  // Never onto its own end.
  assertEqual(clampNoteRangeStart(3, 3), 2.999);
});

check("reads the frame at a source time inside a window that does not start at 0", () => {
  // A window of 4 s starting at source 4 s, sampled 8 frames deep (2 frames / s).
  assertEqual(noteFrameAt(4, 4, 4, 8), 0);
  assertEqual(noteFrameAt(4.5, 4, 4, 8), 1);
  assertEqual(noteFrameAt(5, 4, 4, 8), 2);
  assertEqual(noteFrameAt(7.999, 4, 4, 8), 7);
  // A time outside the window reads its nearest edge frame, never out of range.
  assertEqual(noteFrameAt(2, 4, 4, 8), 0);
  assertEqual(noteFrameAt(9, 4, 4, 8), 7);
  // Degenerate grids never index out of range.
  assertEqual(noteFrameAt(5, 4, 0, 8), 0);
  assertEqual(noteFrameAt(5, 4, 4, 0), 0);
});

check("reads a matrix tool's values line, not a series one", () => {
  // A `MatrixResult` carries `times` as well as `bins`/`values`, so a naive
  // `"times" in result` test classified mel / MFCC / chroma / contrast heatmaps as a
  // series and read `view.formatY` (undefined for a matrix tool) — which threw inside
  // `createNote` and silently dropped the note.
  const matrix: MatrixResult = {
    tool: "melSpectrogram",
    sampleRate: 48000,
    hopSize: 512,
    frames: 2,
    bins: 3,
    duration: 2,
    times: [0, 1],
    windowStart: 0,
    bands: [0, 1, 2],
    // Frame 0: band 2 peaks; frame 1: band 1 peaks.
    values: [1, 2, 3, 4, 5, 1],
    minValue: 1,
    maxValue: 5,
  };
  assertEqual(valuesText("melSpectrogram", matrix, 0), "t 0.000 s · mel band mel 3: 3.0");
  assertEqual(valuesText("melSpectrogram", matrix, 1), "t 1.000 s · mel band mel 2: 5.0");
  // Even a zeroed grid must not throw (the mel/MFCC window can be too short to frame).
  const empty: MatrixResult = { ...matrix, frames: 0, bins: 0, values: [] };
  assertEqual(valuesText("melSpectrogram", empty, 0), "t 0.000 s · no data");

  const series: SeriesResult = {
    tool: "spectralCentroid",
    sampleRate: 48000,
    hopSize: 512,
    frames: 2,
    times: [0, 1],
    windowStart: 0,
    values: [100, 220],
    minValue: 100,
    maxValue: 220,
  };
  assertEqual(valuesText("spectralCentroid", series, 1), "t 1.000 s · centroid (Hz) 220 Hz");
});

check("reads a note segment's values line, or its gap", () => {
  const result: NoteMetricsResult = {
    tool: "noteMetrics",
    windowStart: 0,
    noteCount: 2,
    gapCount: 1,
    totalGapSecs: 0.1,
    longestGapSecs: 0.1,
    medianNoteSecs: 0.2,
    medianGapSecs: 0.1,
    thresholdDb: -44,
    envelopePositions: [0, 1],
    referenceNoteIndex: 0,
    notes: [
      {
        startSecs: 0,
        endSecs: 0.2,
        durationSecs: 0.2,
        gapBeforeSecs: 0,
        gapAfterSecs: 0.1,
        rmsDb: -9.03,
        peakDb: -6.02,
        rmsDbRelLoudest: 0,
        peakDbRelLoudest: 0,
        envelopeDb: [-9, -9],
      },
      {
        startSecs: 0.3,
        endSecs: 0.5,
        durationSecs: 0.2,
        gapBeforeSecs: 0.1,
        gapAfterSecs: 0,
        rmsDb: -15.05,
        peakDb: -12.04,
        rmsDbRelLoudest: -6.02,
        peakDbRelLoudest: -6.02,
        envelopeDb: [-15, -15],
      },
    ],
    gaps: [{ startSecs: 0.2, endSecs: 0.3, durationSecs: 0.1 }],
  };
  assertEqual(valuesText("noteMetrics", result, 0.1), "t 0.100 s · note 1/2 · RMS -9.0 dBFS");
  assertEqual(valuesText("noteMetrics", result, 0.25), "t 0.250 s · gap 100 ms");
  assertEqual(valuesText("noteMetrics", result, 0.9), "t 0.900 s · no note");
});

const base = (overrides: Partial<NoteValues> = {}): NoteValues => ({
  tool: "spectrum",
  label: "Spectrum @ 2.34 s",
  text: "peak 880.0 Hz · −12.4 dB",
  window: { startSecs: 0, endSecs: 4 },
  params: {
    fftSize: 2048,
    hop: 0.25,
    randomizedOverlap: false,
    windowFn: "hann",
    channel: null,
    resampleTo: null,
    freqMinHz: 0,
    freqMaxHz: 0,
  },
  options: { showMean: 1 },
  capturedMs: 1,
  ...overrides,
});

check("compares snapshots by value (the stale predicate)", () => {
  assertEqual(valuesEqual(null, null), true);
  assertEqual(valuesEqual(base(), null), false);
  assertEqual(valuesEqual(base(), base()), true);
  assertEqual(valuesEqual(base(), base({ text: "different" })), false);
  assertEqual(valuesEqual(base(), base({ window: { startSecs: 0, endSecs: 2 } })), false);
  assertEqual(valuesEqual(base(), base({ options: { showMean: 0 } })), false);
  assertEqual(valuesEqual(base(), base({ params: { ...base().params, fftSize: 4096 } })), false);
});

report("notes");
