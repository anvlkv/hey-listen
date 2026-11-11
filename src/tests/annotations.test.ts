import { expect, it } from "vitest";
import {
  clampAnnotationRange,
  clampAnnotationRangeEnd,
  clampAnnotationRangeStart,
  clampAnnotationTime,
  annotationBody,
  annotationExcerpt,
  annotationFrameAt,
  annotationHeading,
  annotationLabel,
  annotationSpan,
  annotationTimeText,
  valuesEqual,
} from "../lib/annotation";
import type { AnnotationValues } from "../bindings/AnnotationValues";
// The *app's* result types, not the bindings': the runner tags every result with the
// tool it came from (`tool`), and `valuesText` dispatches on it.
import type { MatrixResult, NoteMetricsResult, SeriesResult } from "../state/analyzer/types";
import { valuesText } from "../state/annotations/format";

/**
 * Unit checks for the annotation helpers (`src/lib/annotation.ts`), runnable without a browser or
 * Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * Covers the pure contract the annotations store relies on: time/range clamping, the row
 * label + excerpt, the time subtitle, and the snapshot comparison behind the stale
 * hint. See `docs/annotations.md`.
 */

it("clamps the anchor time to the source", () => {
  expect(clampAnnotationTime(2.5, 4)).toBe(2.5);
  expect(clampAnnotationTime(-1, 4)).toBe(0);
  expect(clampAnnotationTime(9, 4)).toBe(4);
  // No source: only the lower bound applies.
  expect(clampAnnotationTime(9, 0)).toBe(9);
  expect(clampAnnotationTime(-3, 0)).toBe(0);
});

it("orders and clamps a range, collapsing a degenerate span", () => {
  expect(clampAnnotationRange({ startSecs: 3, endSecs: 1 }, 4)).toEqual({
    startSecs: 1,
    endSecs: 3,
  });
  expect(clampAnnotationRange({ startSecs: -1, endSecs: 9 }, 4)).toEqual({
    startSecs: 0,
    endSecs: 4,
  });
  expect(clampAnnotationRange({ startSecs: 2, endSecs: 2 }, 4)).toBeNull();
});

it("excerpts the first non-empty line, ellipsised", () => {
  expect(annotationExcerpt("\n  First line  \nsecond")).toBe("First line");
  expect(annotationExcerpt("")).toBe("");
  const long = "x".repeat(80);
  expect(annotationExcerpt(long, 10)).toBe(`${"x".repeat(10)}…`);
  expect(annotationExcerpt(long, 10).endsWith("…")).toBe(true);
});

it("derives the heading from the body's first line (markdown stripped)", () => {
  expect(annotationHeading("Third harmonic\npeak at 880 Hz")).toBe("Third harmonic");
  expect(annotationHeading("# Third harmonic\n\nmore")).toBe("Third harmonic");
  expect(annotationHeading("- item one\n- item two")).toBe("item one");
  expect(annotationHeading("[880 Hz](http://x) peak")).toBe("880 Hz peak");
  expect(annotationHeading("**Bold** and `code`")).toBe("Bold and code");
  expect(annotationHeading("   \n  ")).toBe("");
  expect(annotationHeading("x".repeat(80), 10)).toBe(`${"x".repeat(10)}…`);
});

it("labels an annotation from its body heading (no separate title)", () => {
  expect(annotationLabel({ title: "ignored", body: "Third harmonic" })).toBe("Third harmonic");
  expect(annotationLabel({ title: null, body: "   " })).toBe("Annotation");
});

it("drops the heading line from the rendered body", () => {
  expect(annotationBody("Third harmonic\n\nPeak at 880 Hz.")).toBe("Peak at 880 Hz.");
  expect(annotationBody("# Third harmonic\n- a\n- b")).toBe("- a\n- b");
  expect(annotationBody("Only a title")).toBe("");
  expect(annotationBody("   \n  ")).toBe("");
});

it("formats a point and a range time subtitle", () => {
  expect(annotationTimeText({ timeSecs: 2.34, range: null })).toBe("2.340 s");
  expect(annotationTimeText({ timeSecs: 2.34, range: { startSecs: 2.34, endSecs: 3.1 } })).toBe(
    "2.340 – 3.100 s",
  );
});

it("spans a point annotation at its anchor and a range annotation across its range", () => {
  expect(annotationSpan({ timeSecs: 2, range: null })).toEqual({ start: 2, end: 2 });
  expect(annotationSpan({ timeSecs: 2, range: { startSecs: 1.5, endSecs: 3 } })).toEqual({
    start: 1.5,
    end: 3,
  });
});

it("clamps a dragged range end so the span never collapses", () => {
  // Inside the source: kept as-is.
  expect(clampAnnotationRangeEnd(1, 2, 4)).toBe(2);
  // Past the source end: clamped to it.
  expect(clampAnnotationRangeEnd(1, 9, 4)).toBe(4);
  // Dragged onto (or past) the start: kept a hairline away, never collapsed.
  expect(clampAnnotationRangeEnd(1, 1, 4)).toBe(1.001);
  expect(clampAnnotationRangeEnd(1, 0.5, 4)).toBe(1.001);
  // Unknown source duration: only the lower bound applies.
  expect(clampAnnotationRangeEnd(1, 3, 0)).toBe(3);
  expect(clampAnnotationRangeEnd(1, 0, 0)).toBe(1.001);
});

it("clamps a dragged range start inside the span", () => {
  expect(clampAnnotationRangeStart(1, 3)).toBe(1);
  expect(clampAnnotationRangeStart(-2, 3)).toBe(0);
  // Never onto its own end.
  expect(clampAnnotationRangeStart(3, 3)).toBe(2.999);
});

it("reads the frame at a source time inside a window that does not start at 0", () => {
  // A window of 4 s starting at source 4 s, sampled 8 frames deep (2 frames / s).
  expect(annotationFrameAt(4, 4, 4, 8)).toBe(0);
  expect(annotationFrameAt(4.5, 4, 4, 8)).toBe(1);
  expect(annotationFrameAt(5, 4, 4, 8)).toBe(2);
  expect(annotationFrameAt(7.999, 4, 4, 8)).toBe(7);
  // A time outside the window reads its nearest edge frame, never out of range.
  expect(annotationFrameAt(2, 4, 4, 8)).toBe(0);
  expect(annotationFrameAt(9, 4, 4, 8)).toBe(7);
  // Degenerate grids never index out of range.
  expect(annotationFrameAt(5, 4, 0, 8)).toBe(0);
  expect(annotationFrameAt(5, 4, 4, 0)).toBe(0);
});

it("reads a matrix tool's values line, not a series one", () => {
  // A `MatrixResult` carries `times` as well as `bins`/`values`, so a naive
  // `"times" in result` test classified mel / MFCC / chroma / contrast heatmaps as a
  // series and read `view.formatY` (undefined for a matrix tool) — which threw inside
  // `createAnnotation` and silently dropped the annotation.
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
    calibrated: false,
    calibrationDbSpl: 0,
  };
  expect(valuesText("melSpectrogram", matrix, 0)).toBe("t 0.000 s · mel band mel 3: 3.0");
  expect(valuesText("melSpectrogram", matrix, 1)).toBe("t 1.000 s · mel band mel 2: 5.0");
  // Even a zeroed grid must not throw (the mel/MFCC window can be too short to frame).
  const empty: MatrixResult = { ...matrix, frames: 0, bins: 0, values: [] };
  expect(valuesText("melSpectrogram", empty, 0)).toBe("t 0.000 s · no data");

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
  expect(valuesText("spectralCentroid", series, 1)).toBe("t 1.000 s · centroid (Hz) 220 Hz");
});

it("reads a note segment's values line, or its gap", () => {
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
        voicedFraction: 1,
        f0MedianHz: 440,
        jitterProxyCents: 2.5,
        shimmerProxyDb: 0.4,
        hnrProxy: 0.98,
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
        voicedFraction: null,
        f0MedianHz: null,
        jitterProxyCents: null,
        shimmerProxyDb: null,
        hnrProxy: null,
      },
    ],
    gaps: [{ startSecs: 0.2, endSecs: 0.3, durationSecs: 0.1 }],
  };
  expect(valuesText("noteMetrics", result, 0.1)).toBe("t 0.100 s · note 1/2 · RMS -9.0 dBFS");
  expect(valuesText("noteMetrics", result, 0.25)).toBe("t 0.250 s · gap 100 ms");
  expect(valuesText("noteMetrics", result, 0.9)).toBe("t 0.900 s · no note");
});

const base = (overrides: Partial<AnnotationValues> = {}): AnnotationValues => ({
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

it("compares snapshots by value (the stale predicate)", () => {
  expect(valuesEqual(null, null)).toBe(true);
  expect(valuesEqual(base(), null)).toBe(false);
  expect(valuesEqual(base(), base())).toBe(true);
  expect(valuesEqual(base(), base({ text: "different" }))).toBe(false);
  expect(valuesEqual(base(), base({ window: { startSecs: 0, endSecs: 2 } }))).toBe(false);
  expect(valuesEqual(base(), base({ options: { showMean: 0 } }))).toBe(false);
  expect(valuesEqual(base(), base({ params: { ...base().params, fftSize: 4096 } }))).toBe(false);
});
