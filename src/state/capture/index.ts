/**
 * Live-capture store (flexaudio sources): enumeration, configuration, the growing
 * PCM buffer, and the recording controls. One capture per project. See
 * `docs/source-model.md`.
 *
 * This module is the package's public surface — it re-exports the store's API, so
 * importers need no changes. The parts live in focused siblings: `types` (kinds,
 * labels, ts-rs aliases), `signals` (the store signals), `enumerate` (device /
 * process listing), `countdown` (the start timer), and `session` (the session engine
 * and recording actions).
 */
export { KIND_LABEL } from "./types";
export type { CaptureKind, SourceChoice } from "./types";
export {
  devices,
  processes,
  sourcesError,
  choice,
  setChoice,
  deviceId,
  setDeviceId,
  mixMicDeviceId,
  setMixMicDeviceId,
  mixSystemDeviceId,
  setMixSystemDeviceId,
  targetPid,
  setTargetPid,
  gain,
  setGainLevel,
  startDelay,
  setStartDelay,
  targetDuration,
  setTargetDuration,
  recording,
  monitoring,
  paused,
  countdown,
  elapsed,
  captureError,
  level,
} from "./signals";
export { refreshDevices, refreshProcesses } from "./enumerate";
export { cancelCountdown } from "./countdown";
export {
  initCapture,
  disposeCapture,
  stopFollowing,
  startMonitor,
  stopMonitor,
  startCapture,
  stopCapture,
  togglePause,
  applyGain,
} from "./session";
