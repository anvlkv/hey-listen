import type { SerializedDockview } from "dockview";
import { sanitizeLayout } from "../src/lib/dockviewLayout";
import {
  compareFamily,
  comparePanelId,
  isCompareId,
  parseCompareTool,
} from "../src/state/compare/id";
import { createPollGate } from "../src/state/compare/live";
import { mergeSeries, nearestColumn, unionTimes } from "../src/components/compare/align";
import { deltaLimit, deltaSpan } from "../src/components/compare/matrix";
import { identicalWindows, bucketTimes } from "../src/components/compare/waveform";
import { pairingSummary } from "../src/components/compare/events";
import { noteRows } from "../src/components/compare/notes";
import { shapeLabel } from "../src/state/compare/picker";
import type { MatrixDiffDto, NotesDiffDto } from "../src/state/compare/types";
import { assertDeepEqual, assertEqual, check, report } from "./testHarness";

/**
 * Unit checks for cross-project comparison (M25): the compare panel id, the family
 * gate, the dockview layout sanitiser (a compare panel is never project content), the
 * peer poll's latest-wins gate, and the overlay alignment that never interpolates.
 */

check("a compare panel id round-trips its tool", () => {
  assertEqual(comparePanelId("spectrum"), "compare:spectrum");
  assertEqual(parseCompareTool("compare:spectrum"), "spectrum");
  assertEqual(isCompareId("compare:spectrum"), true);
});

check("a non-compare or unknown tool id is not a compare panel", () => {
  assertEqual(parseCompareTool("spectrum"), null);
  assertEqual(parseCompareTool("compare:nope"), null);
  assertEqual(isCompareId("spectrum"), false);
});

check("the family gate maps every chart kind to a compare family", () => {
  assertEqual(compareFamily("spectralCentroid"), "series");
  assertEqual(compareFamily("spectrum"), "spectrum");
  assertEqual(compareFamily("levels"), "scalar");
  assertEqual(compareFamily("mfcc"), "matrix");
  assertEqual(compareFamily("spectrogram"), "spectrogram");
  assertEqual(compareFamily("onsets"), "events");
  assertEqual(compareFamily("noteMetrics"), "notes");
  assertEqual(compareFamily("modulation"), "modulation");
  assertEqual(compareFamily("waveform"), "waveform");
});

/** A serialized layout with one group (or a caller-built grid), cast for the sanitiser. */
function layout(views: string[], activeView?: string): SerializedDockview {
  return {
    grid: {
      root: {
        type: "leaf",
        data: { id: "group-1", views, activeView },
        size: 800,
      },
      width: 800,
      height: 600,
      orientation: "HORIZONTAL",
    },
    panels: Object.fromEntries(views.map((id) => [id, { id, title: id }])),
    activeGroup: "group-1",
  } as unknown as SerializedDockview;
}

check("a compare panel is stripped from the saved layout", () => {
  const sanitized = sanitizeLayout(
    layout(["spectrum", "compare:spectrum"], "compare:spectrum"),
    isCompareId,
  );
  assertEqual(sanitized != null, true);
  const root = sanitized!.grid.root as unknown as {
    data: { views: string[]; activeView?: string };
  };
  assertDeepEqual(root.data.views, ["spectrum"]);
  assertEqual(root.data.activeView, undefined);
  assertDeepEqual(Object.keys(sanitized!.panels), ["spectrum"]);
});

check("a group left empty by the compare panel is pruned", () => {
  const original = {
    grid: {
      root: {
        type: "branch",
        data: [
          { type: "leaf", data: { id: "g1", views: ["compare:spectrum"] }, size: 400 },
          { type: "leaf", data: { id: "g2", views: ["mfcc"] }, size: 400 },
        ],
        size: 800,
      },
      width: 800,
      height: 600,
      orientation: "VERTICAL",
    },
    panels: {
      "compare:spectrum": { id: "compare:spectrum" },
      mfcc: { id: "mfcc" },
    },
    activeGroup: "g1",
  } as unknown as SerializedDockview;
  const sanitized = sanitizeLayout(original, isCompareId)!;
  // The root **stays a branch** — `fromJSON` rejects a leaf root — with the surviving
  // group as its only child; dockview flattens that once the layout is live.
  const root = sanitized.grid.root as unknown as {
    type: string;
    data: { type: string; data: { id: string; views: string[] } }[];
  };
  assertEqual(root.type, "branch");
  assertEqual(root.data.length, 1);
  assertEqual(root.data[0].data.id, "g2");
  assertDeepEqual(root.data[0].data.views, ["mfcc"]);
  // The active group pointed at the removed group, so it is dropped.
  assertEqual(sanitized.activeGroup, undefined);
});

check("a floating group keeps only its project views", () => {
  const original = {
    grid: layout(["spectrum"]).grid,
    panels: { spectrum: { id: "spectrum" }, "compare:spectrum": { id: "compare:spectrum" } },
    floatingGroups: [
      {
        data: { id: "f1", views: ["spectrum", "compare:spectrum"], activeView: "compare:spectrum" },
        position: { top: 0, left: 0, width: 100, height: 100 },
      },
      {
        data: { id: "f2", views: ["compare:spectrum"] },
        position: { top: 0, left: 0, width: 100, height: 100 },
      },
    ],
  } as unknown as SerializedDockview;
  const sanitized = sanitizeLayout(original, isCompareId)!;
  type Float = { data: { id: string; views: string[]; activeView?: string } };
  const groups = sanitized.floatingGroups as unknown as Float[];
  // The group left with nothing is dropped; the other keeps its pruned view list.
  assertEqual(groups.length, 1);
  assertDeepEqual(groups[0].data.views, ["spectrum"]);
  assertEqual(groups[0].data.activeView, undefined);
});

check("a layout that is only a compare panel sanitizes to nothing", () => {
  const sanitized = sanitizeLayout(layout(["compare:spectrum"], "compare:spectrum"), isCompareId);
  assertEqual(sanitized, null);
});

check("the poll gate accepts only the newest request", () => {
  const gate = createPollGate();
  const first = gate.begin();
  const second = gate.begin();
  assertEqual(gate.accept(first), false);
  assertEqual(gate.accept(second), true);
});

check("two series merge onto one absolute-time axis", () => {
  const times = unionTimes([0, 0.5, 1], [0.25, 0.75], 0.05);
  assertDeepEqual(times, [0, 0.25, 0.5, 0.75, 1]);
  assertDeepEqual(nearestColumn([0, 0.5, 1], [1, 2, 3], times, 0.1), [1, null, 2, null, 3]);
});

check("a differing window aligns on time, not on index", () => {
  // The real tolerance is 0.6 × hop (hop = 0.1 here), so a target without a frame
  // within that distance stays a gap rather than borrowing a distant value.
  const merged = mergeSeries([0.1, 0.2, 0.3], [1, 2, 3], [0.2, 0.3, 0.4], [7, 8, 9], [], [], 0.06);
  // 0.1 exists on A only; 0.2/0.3 match; 0.4 exists on B only.
  assertDeepEqual(merged.times, [0.1, 0.2, 0.3, 0.4]);
  assertDeepEqual(merged.a, [1, 2, 3, null]);
  assertDeepEqual(merged.b, [null, 7, 8, 9]);
  assertDeepEqual(merged.delta, [null, null, null, null]);
});

check("a source shape label is human-readable", () => {
  assertEqual(
    shapeLabel({ sampleRate: 48000, channels: 2, duration: 12.34 }),
    "48.0 kHz · stereo · 12.3 s",
  );
  assertEqual(shapeLabel(null), "no source");
});

// --- M25.A view helpers -----------------------------------------------------

check("a Δ heatmap is symmetric around zero", () => {
  assertEqual(deltaLimit([1, -4, 2]), 4);
  assertEqual(deltaLimit([]), 0.001);
  const diff = { times: [0, 0.5, 1] } as MatrixDiffDto;
  // One hop past the last matched frame, so the image covers the last column.
  assertDeepEqual(deltaSpan(diff), { start: 0, end: 1.5 });
  assertEqual(deltaSpan({ times: [] } as unknown as MatrixDiffDto), null);
});

check("a waveform only overlays on an identical window", () => {
  const span = { start: 0.5, end: 1.5 };
  assertEqual(identicalWindows(span, { ...span }, 128, 128), true);
  assertEqual(identicalWindows(span, { start: 0.5, end: 1.6 }, 128, 128), false);
  assertEqual(identicalWindows(span, { ...span }, 128, 256), false);
  assertEqual(identicalWindows(span, { ...span }, 0, 0), false);
  assertDeepEqual(bucketTimes(10, 2, 4), [10, 10.5, 11, 11.5]);
  assertDeepEqual(bucketTimes(0, 2, 0), []);
});

check("an event pairing summarizes both sides", () => {
  assertEqual(
    pairingSummary({
      matched: 2,
      onlyA: 1,
      onlyB: 0,
      meanAbsDt: 0.01,
      pairs: [],
      onlyATimes: [],
      onlyBTimes: [],
    }),
    "2 matched · 1 only A · 0 only B · mean |Δt| 10.0 ms",
  );
});

check("the note table pairs matches and keeps one-sided notes", () => {
  const diff = {
    matched: 1,
    onlyA: 1,
    onlyB: 1,
    meanAbsDt: 0.002,
    pairs: [
      {
        aStart: 0.2,
        bStart: 0.22,
        dt: 0.02,
        aDuration: 0.1,
        bDuration: 0.12,
        durationDelta: 0.02,
        aRmsDb: -20,
        bRmsDb: -18,
        rmsDeltaDb: 2,
      },
    ],
    onlyAStarts: [0.5],
    onlyBStarts: [0.1],
  } as NotesDiffDto;
  const rows = noteRows(diff);
  assertDeepEqual(
    rows.map((row) => row.kind),
    ["onlyB", "pair", "onlyA"],
  );
  assertEqual(rows[1].aStart, 0.2);
  assertEqual(rows[1].rmsDeltaDb, 2);
  assertEqual(rows[0].aStart, null);
  assertEqual(rows[2].bStart, null);
});

report("compare");
