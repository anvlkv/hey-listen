import {
  applyOptionPatch,
  engineOptions,
  loadToolOptions,
  optionDefaults,
  toolOptions,
} from "../src/state/analyzer/options";
import { assertDeepEqual, assertEqual, check, report } from "./testHarness";

/**
 * Unit checks for per-tool option integrity (M16): canonical keys, snake_case
 * aliases, unknown-key rejection, the engine/view split, and filling new defaults
 * into an older project's option map.
 */

function errorFrom(run: () => void): string {
  try {
    run();
  } catch (err) {
    return String(err);
  }
  return "";
}

check("snake_case aliases canonicalize", () => {
  assertDeepEqual(applyOptionPatch("pitchYin", { min_f0_hz: 50, maxF0Hz: 4000 }), {
    minF0Hz: 50,
    maxF0Hz: 4000,
  });
});

check("an unknown option key fails loudly", () => {
  const message = errorFrom(() => applyOptionPatch("pitchYin", { nope: 1 }));
  if (!message.includes("unknown option")) {
    throw new Error(`expected an unknown-option error, got ${message}`);
  }
});

check("a non-numeric option value fails", () => {
  const message = errorFrom(() => applyOptionPatch("pitchYin", { minF0Hz: "low" }));
  if (!message.includes("must be a number")) {
    throw new Error(`expected a number error, got ${message}`);
  }
});

check("chart-display toggles never cross IPC", () => {
  assertDeepEqual(engineOptions("spectrum", { showMean: 1, logFreq: 0 }), {});
  assertDeepEqual(engineOptions("melSpectrogram", { nMels: 64 }), { nMels: 64 });
});

check("the compact option defaults are engine-only", () => {
  const pitch = optionDefaults("pitchYin");
  assertEqual(pitch.minF0Hz, 50);
  assertEqual(pitch.maxF0Hz, 2000);
  assertEqual(pitch.yinThreshold, 0.12);
  assertEqual("showMean" in optionDefaults("spectrum"), false);
});

check("frame-RMS options are engine options with defaults", () => {
  assertDeepEqual(optionDefaults("frameRms"), { frameMs: 10, hopMs: 5 });
  assertDeepEqual(applyOptionPatch("frameRms", { frame_ms: 20, hop_ms: 10 }), {
    frameMs: 20,
    hopMs: 10,
  });
});

check("note-segmentation options are engine options with defaults", () => {
  assertDeepEqual(optionDefaults("noteMetrics"), {
    frameMs: 10,
    hopMs: 5,
    gateDb: 35,
    gateFloorDb: -60,
    hysteresisDb: 3,
    minNoteMs: 20,
    minGapMs: 30,
    envelopePoints: 7,
    pitchFrameMs: 40,
    pitchHopMs: 5,
    minF0Hz: 50,
    maxF0Hz: 2000,
  });
  assertDeepEqual(applyOptionPatch("noteMetrics", { gate_db: 40, min_note_ms: 15 }), {
    gateDb: 40,
    minNoteMs: 15,
  });
});

check("note voice-quality options accept snake_case aliases", () => {
  assertDeepEqual(
    applyOptionPatch("noteMetrics", {
      pitch_frame_ms: 30,
      pitch_hop_ms: 2,
      min_f0_hz: 80,
      max_f0_hz: 1000,
    }),
    { pitchFrameMs: 30, pitchHopMs: 2, minF0Hz: 80, maxF0Hz: 1000 },
  );
  assertDeepEqual(engineOptions("noteMetrics"), optionDefaults("noteMetrics"));
});

check("modulation options are engine options with defaults", () => {
  assertDeepEqual(optionDefaults("modulation"), {
    frameMs: 10,
    hopMs: 2.5,
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
  assertDeepEqual(
    applyOptionPatch("modulation", {
      mod_max_hz: 60,
      min_voiced_secs: 0.4,
      top_peaks: 5,
      pitch_hop_ms: 2,
    }),
    { modMaxHz: 60, minVoicedSecs: 0.4, topPeaks: 5, pitchHopMs: 2 },
  );
  assertDeepEqual(engineOptions("modulation"), optionDefaults("modulation"));
});

check("loading an older project fills in new option defaults", () => {
  loadToolOptions({ pitchYin: { yinThreshold: 0.2 } });
  assertEqual(toolOptions.pitchYin.minF0Hz, 50);
  assertEqual(toolOptions.pitchYin.maxF0Hz, 2000);
  assertEqual(toolOptions.pitchYin.yinThreshold, 0.2);
});

report("analyzerOptions");
