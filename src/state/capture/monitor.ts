import { createEffect, createRoot, on } from "solid-js";
import { choice, deviceId, mixMicDeviceId, mixSystemDeviceId, targetPid } from "./signals";
import { startMonitor, stopMonitor } from "./session";

/**
 * The capture **monitor lifecycle** (M43), at the store level.
 *
 * Selecting a live kind opens a capture session so the input meter is live while idle;
 * switching to a file or synth closes it. Running this here — not in the Sources panel —
 * means switching activity tabs never closes a live input: the rail is only a view of
 * the store.
 */
createRoot(() => {
  createEffect(
    on(
      () => [choice(), deviceId(), targetPid(), mixMicDeviceId(), mixSystemDeviceId()] as const,
      ([kind, , pid]) => {
        if (kind === "file" || kind === "synth" || (kind === "process" && pid == null))
          void stopMonitor();
        else void startMonitor();
      },
    ),
  );
});
