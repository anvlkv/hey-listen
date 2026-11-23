import { expect, it } from "vitest";
import type { ResultSummary } from "../bindings/ResultSummary";
import type { SharedParams } from "../bindings/SharedParams";
import type { SeriesResult } from "../state/analyzer/types";
import { latestSummary, setLatestSummary } from "../state/analyzer/results";
import { annotationValuesFor } from "../state/annotations/valuesSnapshot";

/**
 * The frozen annotation snapshot's **structured items** (D-19): the capture reads the
 * canonical summary of the tool's live run and copies its items onto `AnnotationValues`.
 * A result adopted from the project cache carries no summary, so a snapshot taken then
 * has an empty `items` list — its one-line `text` subtitle is unaffected either way.
 */

const params: SharedParams = {
  fftSize: 2048,
  hop: 0.25,
  randomizedOverlap: false,
  windowFn: "hann",
  channel: null,
  resampleTo: null,
  freqMinHz: 0,
  freqMaxHz: 0,
};

const series: SeriesResult = {
  tool: "spectralCentroid",
  sampleRate: 48000,
  hopSize: 512,
  frames: 2,
  times: [0, 1],
  windowStart: 0,
  values: [100, 220],
  minValue: 100,
  maxValue: 220,
};

const summary: ResultSummary = {
  tool: "spectralCentroid",
  label: "Spectral centroid",
  text: "centroid 220 Hz · peak frequency 440 Hz",
  items: [
    { key: "centroidHz", label: "centroid", value: 220, unit: "Hz" },
    { key: "peakHz", label: "peak frequency", value: 440, unit: "Hz" },
  ],
};

function snapshot() {
  return annotationValuesFor({
    tool: "spectralCentroid",
    result: series,
    timeSecs: 1,
    window: { startSecs: 0, endSecs: 2 },
    params,
    options: {},
    capturedMs: 42,
    summary: summary.items,
  });
}

it("copies the live run's summary items onto the snapshot", () => {
  const values = snapshot();
  expect(values.summary).toEqual(summary.items);
  // The structured items are additive: the one-line subtitle is unchanged.
  expect(values.text).toBe("t 1.000 s · centroid (Hz) 220 Hz");
});

it("stores the live summary per tool and clears it with the result", () => {
  setLatestSummary("spectralCentroid", summary);
  expect(latestSummary("spectralCentroid")?.items).toEqual(summary.items);

  // A cleared summary (a cached result, or no run yet) leaves the items empty.
  setLatestSummary("spectralCentroid", null);
  expect(latestSummary("spectralCentroid")).toBeNull();
});
