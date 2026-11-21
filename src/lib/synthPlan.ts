/**
 * Pure decisions for the synth **Live** scheduler (M22 / ADR-21).
 *
 * Kept free of stores and Tauri so the rules — the Live length cap, whether a first
 * adoption confirms, and the latest-wins debounce — can be unit-tested.
 * `state/synthLive.ts` owns the effects and the IPC.
 */

/** Live renders are capped for responsiveness; longer graphs use Render once. */
export const LIVE_MAX_SECONDS = 10;
/** Quiet time before a settled edit re-renders. */
export const SYNTH_DEBOUNCE_MS = 160;

/** The length one Live render asks the core for (the tiny floor matches the core's). */
export function liveRenderSeconds(seconds: number): number {
  const length = Number.isFinite(seconds) ? Math.max(0.1, seconds) : 4;
  return Math.min(length, LIVE_MAX_SECONDS);
}

/** Whether a Live write must confirm before discarding a non-synth source. */
export function needsSynthConfirmation(current: { origin?: "synth" } | null): boolean {
  return current != null && current.origin !== "synth";
}

/** A trailing debounce whose latest invocation wins. */
export interface SynthDebounce {
  schedule(): void;
  cancel(): void;
  isCurrent(token: number): boolean;
}

export function createSynthDebounce(
  run: (token: number) => void,
  delay = SYNTH_DEBOUNCE_MS,
): SynthDebounce {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
  return {
    schedule() {
      if (timer !== undefined) clearTimeout(timer);
      const next = ++token;
      timer = setTimeout(() => {
        timer = undefined;
        run(next);
      }, delay);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      token++;
    },
    isCurrent(current) {
      return current === token;
    },
  };
}
