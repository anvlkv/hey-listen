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
import { clipSeries, compareTime, displayTimes } from "../src/components/compare/time";
import { shapeLabel } from "../src/state/compare/picker";
import { openCompareTabs, pruneViews, setCompareViews } from "../src/state/compare/views";
import {
  compareOffset,
  compareSignature,
  setCompareFingerprint,
  setReference,
  setSavedReference,
  viewFor,
} from "../src/state/compare/views";
import type { SavedComparisonInfo } from "../src/bindings/SavedComparisonInfo";
import { setOpenCompareIds, setOpenTools } from "../src/state/workbench";
import type { ComparisonDto, MatrixDiffDto, NotesDiffDto } from "../src/state/compare/types";
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

/** A comparison shaped just enough for the relative-time helpers. */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function comparisonFor(
  aStart: number,
  aDuration: number,
  bStart: number,
  bDuration: number,
  bOffset: number,
): ComparisonDto {
  const side = (project: string, start: number) =>
    ({
      project,
      source: null,
      window: { start, end: start + 1 },
      params: {},
      options: {},
      summary: {},
      result: { tool: "frameRms", windowStart: start },
    }) as never;
  return {
    tool: "frameRms",
    a: side("A", aStart),
    b: side("B", bStart),
    comparability: {
      aligned: true,
      alignment: {
        aDuration,
        bDuration,
        bOffset,
        common: { start: Math.max(0, bOffset), end: Math.min(aDuration, bOffset + bDuration) },
      },
      overlap: null,
      mismatches: [],
      filtersDiffer: false,
    },
  } as ComparisonDto;
}

check("each side starts at 0 and the reference is shifted by the offset", () => {
  const time = compareTime(
    () => comparisonFor(2, 1, 5, 0.6, 0.1),
    () => false,
  );
  assertEqual(time.originA(), 2);
  assertEqual(time.originB(), 5);
  assertEqual(time.extent(), 1);
  assertEqual(time.a(2.5), 0.5);
  assertEqual(round6(time.b(5.2)), 0.3); // 0.2 into B's window, +0.1 δ
  assertDeepEqual(time.bWindow(), { start: 0.1, end: 0.7 });
  assertEqual(time.clipped(), true);
  assertEqual(time.toSource(0.5), 2.5);
  assertEqual(time.fromSource(2.5), 0.5);
});

check("Swap A/B swaps the extent, clipping and the offset sign", () => {
  const swapped = compareTime(
    () => comparisonFor(2, 1, 5, 0.6, 0.1),
    () => true,
  );
  assertEqual(swapped.originA(), 5);
  assertEqual(swapped.extent(), 0.6);
  assertEqual(round6(swapped.a(5.2)), 0.2);
  assertEqual(round6(swapped.b(2.5)), 0.4); // A's 0.5 into its window, −0.1 δ
  assertDeepEqual(swapped.bWindow(), { start: -0.1, end: 0.9 });
  assertEqual(round6(swapped.delta(0.2)), 0.1);
  assertEqual(round6(swapped.toSource(0.2)), 2.3);
});

check("relative times and clipping trim a side at the axis end", () => {
  assertDeepEqual(displayTimes([2, 2.5], 2, 0.1).map(round6), [0.1, 0.6]);
  const clipped = clipSeries([0, 1, 2, 3], [10, 11, 12, 13], 0, 2);
  assertDeepEqual(clipped.times, [0, 1, 2]);
  assertDeepEqual(clipped.values, [10, 11, 12]);
});

check("a saved reference restores its offset, and retargeting a live project resets it", () => {
  const info: SavedComparisonInfo = {
    tool: "spectrum",
    referenceName: "Ref project",
    source: { sampleRate: 48_000, channels: 1, duration: 2 },
    window: { start: 0.5, end: 1.5 },
    bOffset: 0.25,
    savedMs: 1,
    fingerprint: "abc",
  };
  setSavedReference("spectrum", info);
  assertEqual(compareOffset("spectrum"), 0.25);
  assertDeepEqual(viewFor("spectrum")?.binding, { kind: "saved", reference: "Ref project" });

  // Reconnecting a live project resets the fine-tune offset (M25.C).
  setReference("spectrum", "project-1");
  assertEqual(compareOffset("spectrum"), 0);
  assertDeepEqual(viewFor("spectrum")?.binding, { kind: "live", reference: "project-1" });

  // The dirty signature follows the binding, the offset and the last fingerprint.
  setCompareFingerprint("spectrum", "def");
  assertDeepEqual(compareSignature(), { spectrum: "live|project-1|0.000000|def" });
  setCompareViews({});
});

check("a compare tab keeps its reference when a tool tab changes", () => {
  // The M25.B regression: deriving compare tabs from `openTools` dropped every
  // reference on any panel add/remove, because `openTools` excludes compare ids.
  const ids = ["compare:spectrum"];
  const views = {
    spectrum: {
      binding: { kind: "live" as const, reference: "project-1" },
      offset: 0,
      fingerprint: null,
    },
  };
  setCompareViews(views);
  setOpenCompareIds(ids);
  setOpenTools(["spectrum", "mfcc"]);
  assertDeepEqual(openCompareTabs(), [
    { tool: "spectrum", with: "project-1", saved: false, offset: 0 },
  ]);
  // A tool-tab change no longer prunes the compare view …
  assertEqual(pruneViews(views, ids), views);
  // … while closing the compare tab does.
  assertDeepEqual(pruneViews(views, []), {});
});

report("compare");
