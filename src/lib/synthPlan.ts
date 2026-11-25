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
/** The shortest render the core accepts. */
const MIN_SECONDS = 0.1;
/** The length a missing or non-finite value falls back to. */
const DEFAULT_SECONDS = 4;

/**
 * The length one Live render asks the core for.
 *
 * **It never truncates.** A Live render that asked for less than the source would
 * silently shorten the timeline — and the saved project with it — so a length over
 * [`LIVE_MAX_SECONDS`] is *skipped* ([`liveTooLong`]) instead: the tab says so, and
 * **Render** covers it.
 */
export function liveRenderSeconds(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(MIN_SECONDS, seconds) : DEFAULT_SECONDS;
}

/** Whether Live must skip this length rather than render a shorter timeline. */
export function liveTooLong(seconds: number): boolean {
  return liveRenderSeconds(seconds) > LIVE_MAX_SECONDS;
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
