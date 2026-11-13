import { expect, it } from "vitest";
import { clipSeries, compareTime, displayTimes } from "../components/compare/time";
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
import type { ComparisonDto } from "../state/compare/types";

/**
 * Unit checks for the compare **relative-time axis** (M25.B) and the id-keyed open-view
 * state (M23 Phase 3): the display transform, swap, clipping, saved-reference restore,
 * and the dirty signature / prune behaviour across several tabs per tool.
 */

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** A comparison shaped just enough for the relative-time helpers. */
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
    id: "cmp-test",
    tool: "spectrum",
    referenceName: "Ref project",
    source: { sampleRate: 48_000, channels: 1, duration: 2 },
    window: { start: 0.5, end: 1.5 },
    ownerWindow: { start: 0.5, end: 1.5 },
    ownerChannel: null,
    bOffset: 0.25,
    savedMs: 1,
    fingerprint: "abc",
  };
  setSavedReference("spectrum", "cmp-test", info);
  expect(compareOffset("spectrum", "cmp-test")).toBe(0.25);
  expect(viewFor("spectrum", "cmp-test")?.binding).toEqual({
    kind: "saved",
    reference: "Ref project",
  });

  // Reconnecting a live project resets the fine-tune offset (M25.C).
  setReference("spectrum", "cmp-test", "project-1");
  expect(compareOffset("spectrum", "cmp-test")).toBe(0);
  expect(viewFor("spectrum", "cmp-test")?.binding).toEqual({
    kind: "live",
    reference: "project-1",
  });

  // The dirty signature follows the binding, the offset and the last fingerprint.
  setCompareFingerprint("spectrum", "cmp-test", "def");
  expect(compareSignature()).toEqual({ "cmp-test": "live|project-1|0.000000|def" });
  setCompareViews({});
});

it("a compare tab keeps its reference when a tool tab changes", () => {
  // The M25.B regression: deriving compare tabs from `openTools` dropped every
  // reference on any panel add/remove, because `openTools` excludes compare ids.
  const ids = ["compare:spectrum:cmp-1"];
  const views = {
    "cmp-1": {
      tool: "spectrum" as const,
      binding: { kind: "live" as const, reference: "project-1" },
      offset: 0,
      fingerprint: null,
    },
  };
  setCompareViews(views);
  setOpenCompareIds(ids);
  setOpenTools(["spectrum", "mfcc"]);
  expect(openCompareTabs()).toEqual([
    { id: "cmp-1", tool: "spectrum", with: "project-1", saved: false, offset: 0 },
  ]);
  // A tool-tab change no longer prunes the compare view …
  expect(pruneViews(views, ids)).toEqual(views);
  // … while closing the compare tab does.
  expect(pruneViews(views, [])).toEqual({});
});
