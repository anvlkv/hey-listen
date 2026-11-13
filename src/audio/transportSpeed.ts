import { createSignal } from "solid-js";
import { SPEED_MAX, SPEED_MIN } from "../lib/previewSpeed";

/**
 * The transport's **varispeed** rate (M23): the session signal the core is loaded with,
 * plus the clamp that mirrors `commands/playback.rs`.
 *
 * The rate is *varispeed* only — it shifts pitch rather than time-stretching — and it is
 * a transport control, never an analysis setting (analysis always reads the source at 1×).
 * The log slider's scale lives in `lib/previewSpeed.ts`; this module owns the value.
 */

/** The varispeed playback rate (1 = real time). Applied on the next region load. */
export const [previewSpeed, setPreviewSpeedSignal] = createSignal(1);

/** Clamp to the range the core honours, treating a non-number as 1×. */
function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

/** Set the preview speed, clamped (kept for the session only). */
export function setPreviewSpeed(value: number) {
  setPreviewSpeedSignal(clampSpeed(value));
}
