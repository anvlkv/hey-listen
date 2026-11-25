import { expect, it } from "vitest";
import {
  applySharedParams,
  channel,
  mergeParams,
  setChannel,
  setFftSize,
  sharedParams,
  type SharedParamsDto,
} from "../state/analysis";

/**
 * A shared-params patch is **partial**: a key it omits is left alone. `channel` and
 * `resampleTo` are the nullable ones, so only an explicit `null` clears them — treating
 * "absent" as "null" reset the channel on every `set_shared_params { fftSize }` and on
 * every `run_analysis { params }` override (the AX test drive hit exactly that).
 */

it("a partial patch leaves the channel alone", () => {
  setChannel(1);
  setFftSize(2048);

  applySharedParams({ fftSize: 4096 });

  expect(channel()).toBe(1);
  expect(sharedParams().fftSize).toBe(4096);
});

it("an explicit null clears the channel and the resample target", () => {
  setChannel(2);

  applySharedParams({ channel: null, resampleTo: null });

  expect(sharedParams().channel).toBeNull();
  expect(sharedParams().resampleTo).toBeNull();
});

it("merges over a snapshot without dropping the keys it omits", () => {
  const base: SharedParamsDto = {
    fftSize: 2048,
    hop: 0.25,
    randomizedOverlap: false,
    windowFn: "hann",
    channel: 3,
    resampleTo: 48_000,
    freqMinHz: 0,
    freqMaxHz: 0,
  };

  const merged = mergeParams(base, { hop: 0.5 });

  expect(merged.channel).toBe(3);
  expect(merged.resampleTo).toBe(48_000);
  expect(merged.hop).toBe(0.5);
  expect(base.hop).toBe(0.25); // the base is not mutated
});
