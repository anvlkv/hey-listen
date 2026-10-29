import type { SerializedDockview } from "dockview";
import { sanitizeLayout } from "../src/lib/dockviewLayout";
import {
  compareFamily,
  comparePanelId,
  compareViewable,
  isCompareId,
  parseCompareTool,
} from "../src/state/compare/id";
import { createPollGate } from "../src/state/compare/live";
import { mergeSeries, nearestColumn, unionTimes } from "../src/components/compare/align";
import { shapeLabel } from "../src/state/compare/picker";
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

check("the family gate charts series, spectrum and readouts in M25", () => {
  assertEqual(compareFamily("spectralCentroid"), "series");
  assertEqual(compareFamily("spectrum"), "spectrum");
  assertEqual(compareFamily("levels"), "scalar");
  assertEqual(compareFamily("mfcc"), "matrix");
  assertEqual(compareFamily("onsets"), "events");
  assertEqual(compareFamily("noteMetrics"), "notes");
  assertEqual(compareFamily("modulation"), "modulation");
  assertEqual(compareFamily("waveform"), "waveform");
  assertEqual(compareViewable("spectralCentroid"), true);
  assertEqual(compareViewable("levels"), true);
  assertEqual(compareViewable("mfcc"), false);
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
  // The lone surviving child is lifted out of the branch.
  const root = sanitized.grid.root as unknown as { type: string; data: { id: string } };
  assertEqual(root.type, "leaf");
  assertEqual(root.data.id, "g2");
  // The active group pointed at the removed group, so it is dropped.
  assertEqual(sanitized.activeGroup, undefined);
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

report("compare");
