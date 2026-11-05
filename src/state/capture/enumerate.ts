import { invoke } from "../../lib/ipc";
import type { DeviceInfo, ProcessInfo } from "./types";
import { setDevices, setProcesses, setSourcesError } from "./signals";

/**
 * Enumerate capture devices (microphones + system output endpoints).
 *
 * Deliberately **not** called at startup: enumeration walks the OS audio stack, and
 * on macOS it cannot even list inputs until microphone consent is decided. So the
 * capture session opens first (which raises the consent prompt), and `ensureSession`
 * requests the list once that session is running. See `docs/source-model.md` →
 * "OS permissions (macOS)".
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
