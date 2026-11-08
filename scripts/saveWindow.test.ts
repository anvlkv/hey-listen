import { windowForSave } from "../src/lib/saveWindow";
import { assertDeepEqual, check, report } from "./testHarness";

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

check("keeps a sub-window when the project has no annotations", () => {
  assertDeepEqual(windowForSave(2, 4, 10, false), { startSecs: 2, endSecs: 4 });
});

check("widens a sub-window to the whole source when annotations exist", () => {
  assertDeepEqual(windowForSave(2, 4, 10, true), { startSecs: 0, endSecs: 10 });
});

check("leaves a window that already covers the source alone", () => {
  assertDeepEqual(windowForSave(0, 10, 10, true), { startSecs: 0, endSecs: 10 });
  // The view is stored in seconds, so accept a rounding-level shortfall.
  assertDeepEqual(windowForSave(0.0004, 9.9996, 10, true), { startSecs: 0.0004, endSecs: 9.9996 });
});

check("does not invent a window for an empty source", () => {
  assertDeepEqual(windowForSave(3, 4, 0, true), { startSecs: 3, endSecs: 4 });
});

report("saveWindow");
