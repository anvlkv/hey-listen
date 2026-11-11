import { expect, it } from "vitest";
import {
  applyOptionPatch,
  engineOptions,
  loadToolOptions,
  optionDefaults,
  toolOptions,
} from "../state/analyzer/options";

/**
 * Unit checks for per-tool option integrity (M16): canonical keys, snake_case
 * aliases, unknown-key rejection, the engine/view split, and filling new defaults
 * into an older project's option map. Run by `npm run test:unit` (vitest).
 */

function errorFrom(run: () => void): string {
  try {
    run();
  } catch (err) {
    return String(err);
  }
  return "";
}

it("snake_case aliases canonicalize", () => {
  expect(applyOptionPatch("pitchYin", { min_f0_hz: 50, maxF0Hz: 4000 })).toEqual({
    minF0Hz: 50,
    maxF0Hz: 4000,
  });
});

it("an unknown option key fails loudly", () => {
  expect(errorFrom(() => applyOptionPatch("pitchYin", { nope: 1 }))).toContain("unknown option");
});

it("a non-numeric option value fails", () => {
  expect(errorFrom(() => applyOptionPatch("pitchYin", { minF0Hz: "low" }))).toContain(
    "must be a number",
  );
});

it("chart-display toggles never cross IPC", () => {
  expect(engineOptions("spectrum", { showMean: 1, frequencyScale: 2, bandGuides: 1 })).toEqual({});
  expect(engineOptions("melSpectrogram", { nMels: 64 })).toEqual({ nMels: 64 });
});

it("the compact option defaults are engine-only", () => {
  const pitch = optionDefaults("pitchYin");
  expect(pitch.minF0Hz).toBe(50);
  expect(pitch.maxF0Hz).toBe(2000);
  expect(pitch.yinThreshold).toBe(0.12);
  expect("showMean" in optionDefaults("spectrum")).toBe(false);
});

it("frame-RMS options are engine options with defaults", () => {
  expect(optionDefaults("frameRms")).toEqual({
    frameMs: 10,
    hopMs: 5,
    gateDb: 0,
    gateFloorDb: -120,
  });
  expect(applyOptionPatch("frameRms", { frame_ms: 20, hop_ms: 10 })).toEqual({
    frameMs: 20,
    hopMs: 10,
  });
});

it("note-segmentation options are engine options with defaults", () => {
  expect(optionDefaults("noteMetrics")).toEqual({
    frameMs: 10,
    hopMs: 5,
    gateDb: 35,
    gateFloorDb: -60,
    hysteresisDb: 3,
    minNoteMs: 20,
    minGapMs: 30,
    syllableGapMs: 0,
    envelopePoints: 7,
    pitchFrameMs: 40,
    pitchHopMs: 5,
    minF0Hz: 50,
    maxF0Hz: 2000,
  });
  expect(applyOptionPatch("noteMetrics", { gate_db: 40, min_note_ms: 15 })).toEqual({
    gateDb: 40,
    minNoteMs: 15,
  });
});

it("note voice-quality options accept snake_case aliases", () => {
  expect(
    applyOptionPatch("noteMetrics", {
      pitch_frame_ms: 30,
      pitch_hop_ms: 2,
      min_f0_hz: 80,
      max_f0_hz: 1000,
    }),
  ).toEqual({ pitchFrameMs: 30, pitchHopMs: 2, minF0Hz: 80, maxF0Hz: 1000 });
  expect(engineOptions("noteMetrics")).toEqual(optionDefaults("noteMetrics"));
});

it("modulation options are engine options with defaults", () => {
  expect(optionDefaults("modulation")).toEqual({
    frameMs: 10,
    hopMs: 5,
    modMinHz: 0.5,
    modMaxHz: 100,
    detrend: 1,
    pitchFrameMs: 40,
    pitchHopMs: 5,
    minVoicedSecs: 0.2,
    topPeaks: 3,
    minF0Hz: 50,
    maxF0Hz: 2000,
  });
  expect(
    applyOptionPatch("modulation", {
      mod_max_hz: 60,
      min_voiced_secs: 0.4,
      top_peaks: 5,
      pitch_hop_ms: 2,
    }),
  ).toEqual({ modMaxHz: 60, minVoicedSecs: 0.4, topPeaks: 5, pitchHopMs: 2 });
  expect(engineOptions("modulation")).toEqual(optionDefaults("modulation"));
});

it("loading an older project fills in new option defaults", () => {
  loadToolOptions({ pitchYin: { yinThreshold: 0.2 } });
  expect(toolOptions.pitchYin.minF0Hz).toBe(50);
  expect(toolOptions.pitchYin.maxF0Hz).toBe(2000);
  expect(toolOptions.pitchYin.yinThreshold).toBe(0.2);
});
