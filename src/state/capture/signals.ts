import { createSignal } from "solid-js";
import type { DeviceInfo, ProcessInfo, SourceChoice } from "./types";

// --- enumeration ---------------------------------------------------------

export const [devices, setDevices] = createSignal<DeviceInfo[]>([]);
export const [processes, setProcesses] = createSignal<ProcessInfo[]>([]);
export const [sourcesError, setSourcesError] = createSignal<string | null>(null);

// --- configuration -------------------------------------------------------

/** What the picker will start (a file opens via the dialog; the rest record). */
export const [choice, setChoice] = createSignal<SourceChoice>("file");
export const [deviceId, setDeviceId] = createSignal<string | null>(null);
export const [mixMicDeviceId, setMixMicDeviceId] = createSignal<string | null>(null);
export const [mixSystemDeviceId, setMixSystemDeviceId] = createSignal<string | null>(null);
export const [targetPid, setTargetPid] = createSignal<number | null>(null);
export const [gain, setGainLevel] = createSignal(1);
export const [startDelay, setStartDelay] = createSignal(0);
/** Auto-stop after this many seconds; `0` means "until stopped". */
export const [targetDuration, setTargetDuration] = createSignal(0);

// --- session -------------------------------------------------------------

export const [recording, setRecording] = createSignal(false);
/** A capture session is open, so the input level is live even while idle. */
export const [monitoring, setMonitoring] = createSignal(false);
export const [paused, setPaused] = createSignal(false);
export const [countdown, setCountdown] = createSignal<number | null>(null);
export const [elapsed, setElapsed] = createSignal(0);
export const [captureError, setCaptureError] = createSignal<string | null>(null);
/** Peak level of recent chunks (0..1), for the input meter. */
export const [level, setLevel] = createSignal(0);
