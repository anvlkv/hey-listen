import { invoke } from "../../lib/ipc";
import type { DeviceInfo, ProcessInfo } from "./types";
import { setDevices, setProcesses, setSourcesError } from "./signals";

/**
 * Enumerate capture devices (microphones + system output endpoints).
 *
 * Deliberately **not** called at startup: enumeration walks the OS audio stack, and
 * on macOS cpal's input scan trips the **microphone** TCC prompt. Deferring it keeps
 * a file / synth project from asking for the mic — call it only once the user is
 * actually choosing a live source (the Source panel does). See
 * `docs/source-model.md` → "OS permissions (macOS)".
 */
export async function refreshDevices() {
  try {
    setDevices(await invoke<DeviceInfo[]>("list_devices"));
    setSourcesError(null);
  } catch (err) {
    setSourcesError(String(err));
  }
}

export async function refreshProcesses() {
  try {
    setProcesses(await invoke<ProcessInfo[]>("list_processes"));
    setSourcesError(null);
  } catch (err) {
    // Per-process capture can be unavailable (permissions / OS version).
    setProcesses([]);
    setSourcesError(String(err));
  }
}
