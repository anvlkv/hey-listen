import { expect, it } from "vitest";
import type { SerializedDockview } from "dockview";
import { sanitizeLayout } from "../lib/dockviewLayout";
import {
  compareViewFamily,
  comparePanelId,
  isCompareId,
  parseCompareTool,
} from "../state/compare/id";
import { createPollGate } from "../state/compare/live";
import { mergeSeries, nearestColumn, unionTimes } from "../components/compare/align";
import { deltaLimit, deltaSpan } from "../components/compare/matrix";
import { identicalWindows, bucketTimes } from "../components/compare/waveform";
import { pairingSummary } from "../components/compare/events";
import { noteRows } from "../components/compare/notes";
import { clipSeries, compareTime, displayTimes } from "../components/compare/time";
import { shapeLabel } from "../state/compare/picker";
import {
  compareOffset,
  compareSignature,
  openCompareTabs,
  pruneViews,
  setCompareFingerprint,
  setCompareViews,
  setReference,
  setSavedReference,
  viewFor,
} from "../state/compare/views";
import type { SavedComparisonInfo } from "../bindings/SavedComparisonInfo";
import { setOpenCompareIds, setOpenTools } from "../state/workbench";
import type { ComparisonDto, MatrixDiffDto, NotesDiffDto } from "../state/compare/types";

/**
 * Unit checks for cross-project comparison (M25): the compare panel id, the family
 * gate, the dockview layout sanitiser (a compare panel is never project content), the
 * peer poll's latest-wins gate, and the overlay alignment that never interpolates.
 */

it("a compare panel id round-trips its tool", () => {
  expect(comparePanelId("spectrum")).toBe("compare:spectrum");
  expect(parseCompareTool("compare:spectrum")).toBe("spectrum");
  expect(isCompareId("compare:spectrum")).toBe(true);
});

it("a non-compare or unknown tool id is not a compare panel", () => {
  expect(parseCompareTool("spectrum")).toBeNull();
  expect(parseCompareTool("compare:nope")).toBeNull();
  expect(isCompareId("spectrum")).toBe(false);
});

it("the family gate maps every chart kind to a compare family", () => {
  expect(compareViewFamily("spectralCentroid")).toBe("series");
  expect(compareViewFamily("spectrum")).toBe("spectrum");
  expect(compareViewFamily("levels")).toBe("scalar");
  expect(compareViewFamily("mfcc")).toBe("matrix");
  expect(compareViewFamily("spectrogram")).toBe("spectrogram");
  expect(compareViewFamily("onsets")).toBe("events");
  expect(compareViewFamily("noteMetrics")).toBe("notes");
  expect(compareViewFamily("modulation")).toBe("modulation");
  expect(compareViewFamily("waveform")).toBe("waveform");
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

it("a compare panel is stripped from the saved layout", () => {
  const sanitized = sanitizeLayout(
    layout(["spectrum", "compare:spectrum"], "compare:spectrum"),
    isCompareId,
  );
  expect(sanitized).not.toBeNull();
  const root = sanitized!.grid.root as unknown as {
    data: { views: string[]; activeView?: string };
  };
  expect(root.data.views).toEqual(["spectrum"]);
  expect(root.data.activeView).toBeUndefined();
  expect(Object.keys(sanitized!.panels)).toEqual(["spectrum"]);
});

it("a group left empty by the compare panel is pruned", () => {
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
  expect(root.type).toBe("branch");
  expect(root.data.length).toBe(1);
  expect(root.data[0].data.id).toBe("g2");
  expect(root.data[0].data.views).toEqual(["mfcc"]);
  // The active group pointed at the removed group, so it is dropped.
  expect(sanitized.activeGroup).toBeUndefined();
});

it("a floating group keeps only its project views", () => {
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
  expect(groups.length).toBe(1);
  expect(groups[0].data.views).toEqual(["spectrum"]);
  expect(groups[0].data.activeView).toBeUndefined();
});

it("a layout that is only a compare panel sanitizes to nothing", () => {
  const sanitized = sanitizeLayout(layout(["compare:spectrum"], "compare:spectrum"), isCompareId);
  expect(sanitized).toBeNull();
});

it("the poll gate accepts only the newest request", () => {
  const gate = createPollGate();
  const first = gate.begin();
  const second = gate.begin();
  expect(gate.accept(first)).toBe(false);
  expect(gate.accept(second)).toBe(true);
});

it("two series merge onto one absolute-time axis", () => {
  const times = unionTimes([0, 0.5, 1], [0.25, 0.75], 0.05);
  expect(times).toEqual([0, 0.25, 0.5, 0.75, 1]);
  expect(nearestColumn([0, 0.5, 1], [1, 2, 3], times, 0.1)).toEqual([1, null, 2, null, 3]);
});

it("a differing window aligns on time, not on index", () => {
  // The real tolerance is 0.6 × hop (hop = 0.1 here), so a target without a frame
  // within that distance stays a gap rather than borrowing a distant value.
  const merged = mergeSeries([0.1, 0.2, 0.3], [1, 2, 3], [0.2, 0.3, 0.4], [7, 8, 9], [], [], 0.06);
  // 0.1 exists on A only; 0.2/0.3 match; 0.4 exists on B only.
  expect(merged.times).toEqual([0.1, 0.2, 0.3, 0.4]);
  expect(merged.a).toEqual([1, 2, 3, null]);
  expect(merged.b).toEqual([null, 7, 8, 9]);
  expect(merged.delta).toEqual([null, null, null, null]);
});

it("a source shape label is human-readable", () => {
  expect(shapeLabel({ sampleRate: 48000, channels: 2, duration: 12.34 })).toBe(
    "48.0 kHz · stereo · 12.3 s",
  );
  expect(shapeLabel(null)).toBe("no source");
});

// --- M25.A view helpers -----------------------------------------------------

it("a Δ heatmap is symmetric around zero", () => {
  expect(deltaLimit([1, -4, 2])).toBe(4);
  expect(deltaLimit([])).toBe(0.001);
  const diff = { times: [0, 0.5, 1] } as MatrixDiffDto;
  // One hop past the last matched frame, so the image covers the last column.
  expect(deltaSpan(diff)).toEqual({ start: 0, end: 1.5 });
  expect(deltaSpan({ times: [] } as unknown as MatrixDiffDto)).toBeNull();
});

it("a waveform only overlays on an identical window", () => {
  const span = { start: 0.5, end: 1.5 };
  expect(identicalWindows(span, { ...span }, 128, 128)).toBe(true);
  expect(identicalWindows(span, { start: 0.5, end: 1.6 }, 128, 128)).toBe(false);
  expect(identicalWindows(span, { ...span }, 128, 256)).toBe(false);
  expect(identicalWindows(span, { ...span }, 0, 0)).toBe(false);
  expect(bucketTimes(10, 2, 4)).toEqual([10, 10.5, 11, 11.5]);
  expect(bucketTimes(0, 2, 0)).toEqual([]);
});

it("an event pairing summarizes both sides", () => {
  expect(
    pairingSummary({
      matched: 2,
      onlyA: 1,
      onlyB: 0,
      meanAbsDt: 0.01,
      pairs: [],
      onlyATimes: [],
      onlyBTimes: [],
    }),
  ).toBe("2 matched · 1 only A · 0 only B · mean |Δt| 10.0 ms");
});

it("the note table pairs matches and keeps one-sided notes", () => {
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
  expect(rows.map((row) => row.kind)).toEqual(["onlyB", "pair", "onlyA"]);
  expect(rows[1].aStart).toBe(0.2);
  expect(rows[1].rmsDeltaDb).toBe(2);
  expect(rows[0].aStart).toBeNull();
  expect(rows[2].bStart).toBeNull();
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

it("each side starts at 0 and the reference is shifted by the offset", () => {
  const time = compareTime(
    () => comparisonFor(2, 1, 5, 0.6, 0.1),
    () => false,
  );
  expect(time.originA()).toBe(2);
  expect(time.originB()).toBe(5);
  expect(time.extent()).toBe(1);
  expect(time.a(2.5)).toBe(0.5);
  expect(round6(time.b(5.2))).toBe(0.3); // 0.2 into B's window, +0.1 δ
  expect(time.bWindow()).toEqual({ start: 0.1, end: 0.7 });
  expect(time.clipped()).toBe(true);
  expect(time.toSource(0.5)).toBe(2.5);
  expect(time.fromSource(2.5)).toBe(0.5);
});

it("Swap A/B swaps the extent, clipping and the offset sign", () => {
  const swapped = compareTime(
    () => comparisonFor(2, 1, 5, 0.6, 0.1),
    () => true,
  );
  expect(swapped.originA()).toBe(5);
  expect(swapped.extent()).toBe(0.6);
  expect(round6(swapped.a(5.2))).toBe(0.2);
  expect(round6(swapped.b(2.5))).toBe(0.4); // A's 0.5 into its window, −0.1 δ
  expect(swapped.bWindow()).toEqual({ start: -0.1, end: 0.9 });
  expect(round6(swapped.delta(0.2))).toBe(0.1);
  expect(round6(swapped.toSource(0.2))).toBe(2.3);
});

it("relative times and clipping trim a side at the axis end", () => {
  expect(displayTimes([2, 2.5], 2, 0.1).map(round6)).toEqual([0.1, 0.6]);
  const clipped = clipSeries([0, 1, 2, 3], [10, 11, 12, 13], 0, 2);
  expect(clipped.times).toEqual([0, 1, 2]);
  expect(clipped.values).toEqual([10, 11, 12]);
});

it("a saved reference restores its offset, and retargeting a live project resets it", () => {
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
  expect(compareOffset("spectrum")).toBe(0.25);
  expect(viewFor("spectrum")?.binding).toEqual({ kind: "saved", reference: "Ref project" });

  // Reconnecting a live project resets the fine-tune offset (M25.C).
  setReference("spectrum", "project-1");
  expect(compareOffset("spectrum")).toBe(0);
  expect(viewFor("spectrum")?.binding).toEqual({ kind: "live", reference: "project-1" });

  // The dirty signature follows the binding, the offset and the last fingerprint.
  setCompareFingerprint("spectrum", "def");
  expect(compareSignature()).toEqual({ spectrum: "live|project-1|0.000000|def" });
  setCompareViews({});
});

it("a compare tab keeps its reference when a tool tab changes", () => {
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
  expect(openCompareTabs()).toEqual([
    { tool: "spectrum", with: "project-1", saved: false, offset: 0 },
  ]);
  // A tool-tab change no longer prunes the compare view …
  expect(pruneViews(views, ids)).toEqual(views);
  // … while closing the compare tab does.
  expect(pruneViews(views, [])).toEqual({});
});
