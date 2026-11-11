import { expect, it } from "vitest";
import { windowForSave } from "../lib/saveWindow";

/**
 * Unit checks for the analysis window a project save persists
 * (`src/lib/saveWindow.ts`), runnable without a browser or Tauri:
 *
 * ```sh
 * npm run test:unit
 * ```
 *
 * The rule: a save that carries annotations stores the whole source, so curating a
 * fragment does not leave the project framed on it (hey-listen-report §6.6).
 */

it("keeps a sub-window when the project has no annotations", () => {
  expect(windowForSave(2, 4, 10, false)).toEqual({ startSecs: 2, endSecs: 4 });
});

it("widens a sub-window to the whole source when annotations exist", () => {
  expect(windowForSave(2, 4, 10, true)).toEqual({ startSecs: 0, endSecs: 10 });
});

it("leaves a window that already covers the source alone", () => {
  expect(windowForSave(0, 10, 10, true)).toEqual({ startSecs: 0, endSecs: 10 });
  // The view is stored in seconds, so accept a rounding-level shortfall.
  expect(windowForSave(0.0004, 9.9996, 10, true)).toEqual({ startSecs: 0.0004, endSecs: 9.9996 });
});

it("does not invent a window for an empty source", () => {
  expect(windowForSave(3, 4, 0, true)).toEqual({ startSecs: 3, endSecs: 4 });
});
