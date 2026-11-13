import { expect, it } from "vitest";
import { annotationRules, handleDragRules } from "../components/annotations/rules";

/**
 * Unit checks for the annotation **vertical rules**' geometry
 * (`src/components/annotations/rules.ts`), runnable without a browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * Covers the pure contract both the Timeline and the analyzer charts rely on: a point
 * annotation draws one edge rule and a range two, at the edges' mapped x positions, and a
 * handle drag adds the edge it started from as a ghost. See `docs/annotations.md` → Surfacing.
 */

/** A 0–10 s view mapped to 0–100 px, so the expected positions are obvious. */
const xFor = (timeSecs: number) => timeSecs * 10;

it("draws one rule for a point annotation", () => {
  const rules = annotationRules({ start: 3, end: 3 }, xFor);
  expect(rules).toEqual([{ edge: "start", timeSecs: 3, x: 30, ghost: false }]);
});

it("draws both edges of a range at their mapped positions", () => {
  const rules = annotationRules({ start: 2.5, end: 6 }, xFor);
  expect(rules.map((rule) => rule.edge)).toEqual(["start", "end"]);
  expect(rules.map((rule) => rule.x)).toEqual([25, 60]);
  expect(rules.every((rule) => !rule.ghost)).toBe(true);
});

it("keeps the dragged-in edge as a ghost beside the moving one", () => {
  const from = { start: 2, end: 6 };
  const to = { start: 2, end: 8 };
  // Dragging the end edge: the ghost sits at the old end, the solid rule at the new one.
  const rules = handleDragRules(from, to, "end", xFor);
  expect(rules).toEqual([
    { edge: "end", timeSecs: 6, x: 60, ghost: true },
    { edge: "end", timeSecs: 8, x: 80, ghost: false },
  ]);

  // Dragging the start edge of a point moves its single edge the same way.
  const point = handleDragRules({ start: 4, end: 4 }, { start: 5, end: 5 }, "start", xFor);
  expect(point.map((rule) => rule.x)).toEqual([40, 50]);
  expect(point.map((rule) => rule.ghost)).toEqual([true, false]);
});
