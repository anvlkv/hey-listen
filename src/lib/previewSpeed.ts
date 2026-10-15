/**
 * The preview **varispeed** slider's scale (M14 follow-up).
 *
 * The transport offers playback speed on a **logarithmic** slider. A linear 0.25×–4×
 * track would crush every slow rate into the first few percent of its width — which is
 * exactly where the useful speeds are — so the slider is scaled by powers of two:
 * `position ∈ [-1, 1]` maps to `speed = 2 ** (2 · position)`, putting **1×** dead centre
 * (−1 → 0.25×, 0 → 1×, +1 → 4×).
 *
 * The range mirrors the core's clamp in `src-tauri/src/commands/playback.rs`, the
 * authoritative one; this module is the single source of truth on the frontend.
 */

/** Slowest preview speed (slider fully left). */
export const SPEED_MIN = 0.25;
/** Fastest preview speed (slider fully right). */
export const SPEED_MAX = 4;

/** The slider position (−1…1) for a speed, clamped to the supported range. */
export function speedToPosition(speed: number): number {
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number.isFinite(speed) ? speed : 1));
  return Math.log(clamped) / Math.log(SPEED_MAX);
}

/** The speed for a slider position (−1…1), clamped to the supported range. */
export function positionToSpeed(position: number): number {
  const at = Math.min(1, Math.max(-1, Number.isFinite(position) ? position : 0));
  return SPEED_MAX ** at;
}
