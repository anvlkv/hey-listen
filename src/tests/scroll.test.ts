import { expect, it } from "vitest";
import { clampScrollTop } from "../lib/scroll";

/**
 * Unit checks for the custom scroll area's offset clamp (`src/lib/scroll.ts`), runnable
 * without a browser or Tauri:
 *
 * ```sh
 * npx vitest run src/tests/scroll.test.ts
 * ```
 *
 * The contract: an offset always stays inside the content, so a filtered list that
 * shrinks under the current scroll position lands on its new end instead of staying
 * scrolled into empty space.
 */

it("keeps an in-range offset and clamps one past the end", () => {
  expect(clampScrollTop(0, 1000, 400)).toBe(0);
  expect(clampScrollTop(120, 1000, 400)).toBe(120);
  expect(clampScrollTop(600, 1000, 400)).toBe(600);
  expect(clampScrollTop(900, 1000, 400)).toBe(600);
});

it("returns 0 when the content fits the viewport", () => {
  expect(clampScrollTop(50, 400, 400)).toBe(0);
  expect(clampScrollTop(50, 100, 400)).toBe(0);
  expect(clampScrollTop(50, 0, 400)).toBe(0);
});

it("treats a negative or NaN offset as the top and an infinite one as the end", () => {
  expect(clampScrollTop(-10, 1000, 400)).toBe(0);
  expect(clampScrollTop(Number.NaN, 1000, 400)).toBe(0);
  expect(clampScrollTop(Number.POSITIVE_INFINITY, 1000, 400)).toBe(600);
});
