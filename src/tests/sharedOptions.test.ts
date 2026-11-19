import { expect, it } from "vitest";
import { didYouMean, nearestName } from "../lib/nearest";
import { ANALYZERS } from "../state/analyzer/defs";
import {
  applyOptionPatch,
  fanOutOption,
  sharedOptionValue,
  toolOptions,
  toolsDeclaring,
  type SharedModelOption,
} from "../state/analyzer/options";

/**
 * D-07 / D-08 / D-10 helpers: the catalog-derived fan-out list, the fan-out write and
 * its store entries, and the "did you mean?" suggestion. Run by `npm run test:unit`.
 */

/** The catalog's declaring tools, computed independently of `toolsDeclaring`. */
function declaredInCatalog(key: SharedModelOption): string[] {
  return ANALYZERS.filter((def) => (def.params ?? []).some((field) => field.key === key)).map(
    (def) => def.id,
  );
}

it("tools declaring a model option are the catalog's, in Sidebar order", () => {
  expect(toolsDeclaring("minF0Hz")).toEqual(declaredInCatalog("minF0Hz"));
  expect(toolsDeclaring("maxF0Hz")).toEqual(declaredInCatalog("maxF0Hz"));
  expect(toolsDeclaring("calibrationDbSpl")).toEqual(declaredInCatalog("calibrationDbSpl"));
  expect(toolsDeclaring("minF0Hz").length).toBeGreaterThan(1);
  expect(toolsDeclaring("calibrationDbSpl").length).toBeGreaterThan(1);
});

it("fanOutOption writes every declaring tool and leaves the others alone", () => {
  const declared = toolsDeclaring("calibrationDbSpl");
  const others = ANALYZERS.map((def) => def.id).filter((id) => !declared.includes(id));
  const before = sharedOptionValue("calibrationDbSpl");
  try {
    fanOutOption("calibrationDbSpl", 94);
    for (const id of declared) expect(toolOptions[id].calibrationDbSpl).toBe(94);
    for (const id of others) expect("calibrationDbSpl" in toolOptions[id]).toBe(false);
    expect(sharedOptionValue("calibrationDbSpl")).toBe(94);
  } finally {
    if (before != null) fanOutOption("calibrationDbSpl", before);
  }
});

it("a non-finite fan-out value is not written", () => {
  const before = toolOptions.harmonicRatio.minF0Hz;
  fanOutOption("minF0Hz", Number.NaN);
  expect(toolOptions.harmonicRatio.minF0Hz).toBe(before);
});

it("nearestName matches within two edits, case-insensitively", () => {
  expect(nearestName("minF0", ["minF0Hz", "maxF0Hz"])).toBe("minF0Hz");
  expect(nearestName("MINF0HZ", ["minF0Hz"])).toBe("minF0Hz");
  expect(nearestName("calibration_db_spl", ["calibrationDbSpl"])).toBe("calibrationDbSpl");
  // A transposition is one edit, not two.
  expect(nearestName("synht", ["filter", "synth"])).toBe("synth");
  expect(nearestName("zzz", ["minF0Hz"])).toBeNull();
});

it("didYouMean formats the suggestion suffix", () => {
  expect(didYouMean("pitchyin", ["pitchYin", "pitchPyin"])).toBe(" (did you mean pitchYin?)");
  expect(didYouMean("nope", ["pitchYin"])).toBe("");
});

it("an unknown option suggests the nearest key and keeps the old prefix", () => {
  const message = messageFrom(() => applyOptionPatch("pitchYin", { minF0H: 50 }));
  expect(message).toContain("unknown option");
  expect(message).toContain("did you mean minF0Hz?");
});

function messageFrom(run: () => void): string {
  try {
    run();
  } catch (err) {
    return String(err);
  }
  return "";
}
