import { expect, it } from "vitest";
import type { SerializedDockview } from "dockview";
import { sanitizeLayout } from "../lib/dockviewLayout";
import {
  compareViewFamily,
  comparePanelId,
  isCompareId,
  newCompareId,
  parseComparePanel,
} from "../state/compare/id";
import { createPollGate } from "../state/compare/live";
import { mergeSeries, nearestColumn, unionTimes } from "../components/compare/align";
import { deltaLimit, deltaSpan } from "../components/compare/matrix";
import { identicalWindows, bucketTimes } from "../components/compare/waveform";
import { pairingSummary } from "../components/compare/events";
import { noteRows } from "../components/compare/notes";
import { shapeLabel } from "../state/compare/picker";
import type { MatrixDiffDto, NotesDiffDto } from "../state/compare/types";

/**
 * Unit checks for cross-project comparison (M25): the compare panel id, the family
 * gate, the dockview layout sanitiser (a compare panel is never project content), the
 * peer poll's latest-wins gate, the overlay alignment that never interpolates, and the
 * M25.A view helpers (matrix Δ, waveform buckets, event pairing, note rows).
 */

it("a compare panel id round-trips its tool and comparison id", () => {
  expect(comparePanelId("spectrum", "cmp-1")).toBe("compare:spectrum:cmp-1");
  expect(parseComparePanel("compare:spectrum:cmp-1")).toEqual({
    tool: "spectrum",
    id: "cmp-1",
  });
  expect(isCompareId("compare:spectrum:cmp-1")).toBe(true);
});

it("a non-compare or unknown tool id is not a compare panel", () => {
  expect(parseComparePanel("spectrum")).toBeNull();
  expect(parseComparePanel("compare:nope:cmp-1")).toBeNull();
  // The id is required: the old per-tool panel shape is not a valid comparison.
  expect(parseComparePanel("compare:spectrum")).toBeNull();
  expect(parseComparePanel("compare:spectrum:")).toBeNull();
  expect(isCompareId("spectrum")).toBe(false);
});

it("every new comparison gets its own id", () => {
  expect(newCompareId()).not.toBe(newCompareId());
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
    layout(["spectrum", "compare:spectrum:cmp-1"], "compare:spectrum:cmp-1"),
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
          { type: "leaf", data: { id: "g1", views: ["compare:spectrum:cmp-1"] }, size: 400 },
          { type: "leaf", data: { id: "g2", views: ["mfcc"] }, size: 400 },
        ],
        size: 800,
      },
      width: 800,
      height: 600,
      orientation: "VERTICAL",
    },
    panels: {
      "compare:spectrum:cmp-1": { id: "compare:spectrum:cmp-1" },
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
    panels: {
      spectrum: { id: "spectrum" },
      "compare:spectrum:cmp-1": { id: "compare:spectrum:cmp-1" },
    },
    floatingGroups: [
      {
        data: {
          id: "f1",
          views: ["spectrum", "compare:spectrum:cmp-1"],
          activeView: "compare:spectrum:cmp-1",
        },
        position: { top: 0, left: 0, width: 100, height: 100 },
      },
      {
        data: { id: "f2", views: ["compare:spectrum:cmp-1"] },
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
  const sanitized = sanitizeLayout(
    layout(["compare:spectrum:cmp-1"], "compare:spectrum:cmp-1"),
    isCompareId,
  );
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
