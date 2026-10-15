import {
  clampNoteRange,
  clampNoteTime,
  noteBody,
  noteExcerpt,
  noteFrameAt,
  noteHeading,
  noteLabel,
  noteTimeText,
  valuesEqual,
} from "../src/lib/note";
import type { NoteValues } from "../src/bindings/NoteValues";
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
