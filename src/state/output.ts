import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { previewPlaying } from "../audio/preview";

/**
 * Output/preview settings: the cpal output device and the preview gain.
 *
 * Both are app-level (one window = one project) and drive the core's preview
 * player (ADR-9): the gain is applied immediately, the device takes effect on the
 * next preview (the core rebuilds its output stream when the device changes).
 */

export interface OutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export const [outputDevices, setOutputDevices] = createSignal<OutputDevice[]>([]);
/** Selected device id, or `null` for the system default. */
export const [outputDeviceId, setOutputDeviceId] = createSignal<string | null>(null);
export const [outputGain, setOutputGain] = createSignal(1);

export async function refreshOutputDevices() {
  try {
    const devices = await invoke<OutputDevice[]>("list_output_devices");
    setOutputDevices(devices);
    // Drop a pick that no longer exists (device unplugged).
    const current = outputDeviceId();
    if (current && !devices.some((device) => device.id === current)) setOutputDeviceId(null);
  } catch (err) {
    console.error("could not list output devices", err);
    setOutputDevices([]);
  }
}

/** Set the preview output gain (linear, 0..2) and apply it to the core. */
export function applyOutputGain(value: number) {
  setOutputGain(value);
  void invoke("set_output_gain", { gain: value });
}

// ---------------------------------------------------------------------------
// Preview output meter
// ---------------------------------------------------------------------------

/** Peak magnitude (0..) of the current preview output, for the toolbar meter. */
export const [outputLevel, setOutputLevel] = createSignal(0);

/**
 * Poll the core's preview output level while a preview is playing, so the toolbar
 * meter tracks the output and falls to silence when nothing is playing. Returns a
 * disposer.
 */
export function initOutputMeter(): () => void {
  const timer = window.setInterval(() => {
    if (!previewPlaying()) {
      setOutputLevel(0);
      return;
    }
    void invoke<number>("output_level")
      .then((level) => setOutputLevel(Number.isFinite(level) ? level : 0))
      .catch(() => setOutputLevel(0));
  }, 60);
  return () => window.clearInterval(timer);
}
