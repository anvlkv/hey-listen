import { expect, it } from "vitest";
import {
  nudgeStep,
  playheadAnnouncement,
  windowAnnouncement,
} from "../components/timeline/announce";

/**
 * Unit checks for the Timeline canvas's screen-reader copy (D-14). The live region and the
 * keyboard map need a DOM and the transport, so they stay an E2E concern; the sentences and
 * the nudge geometry are pure and pinned here.
 *
 * ```sh
 * npm run test:unit
 * ```
 */

it("announces the analysis window as times plus its length", () => {
  expect(windowAnnouncement(1.2, 2.3)).toBe("Analysis window 0:01.20 to 0:02.30, 1.10 seconds.");
  expect(windowAnnouncement(0, 0.5)).toBe("Analysis window 0:00.00 to 0:00.50, 0.50 seconds.");
});

it("announces a long window without switching units", () => {
  // Minutes keep counting past 60: the copy matches the toolbar's `formatTime` readout.
  expect(windowAnnouncement(0, 3600)).toBe("Analysis window 0:00.00 to 60:00.00, 3600.00 seconds.");
});

it("announces the playhead in the toolbar's time format", () => {
  expect(playheadAnnouncement(1.2)).toBe("Playhead at 0:01.20.");
  expect(playheadAnnouncement(0)).toBe("Playhead at 0:00.00.");
  expect(playheadAnnouncement(61.5)).toBe("Playhead at 1:01.50.");
});

it("nudges by roughly 1% of the visible span", () => {
  expect(nudgeStep(2)).toBeCloseTo(0.02, 10);
  expect(nudgeStep(600)).toBeCloseTo(6, 10);
  expect(nudgeStep(3600)).toBeCloseTo(36, 10);
});

it("floors a nudge at 1 ms on a tiny or unusable span", () => {
  expect(nudgeStep(0.05)).toBe(0.001);
  expect(nudgeStep(0)).toBe(0.001);
  expect(nudgeStep(Number.NaN)).toBe(0.001);
});
