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

check("loading an older project fills in new option defaults", () => {
  loadToolOptions({ pitchYin: { yinThreshold: 0.2 } });
  assertEqual(toolOptions.pitchYin.minF0Hz, 50);
  assertEqual(toolOptions.pitchYin.maxF0Hz, 2000);
  assertEqual(toolOptions.pitchYin.yinThreshold, 0.2);
});

report("analyzerOptions");
