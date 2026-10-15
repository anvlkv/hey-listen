import { countdown, setCountdown } from "./signals";

let countdownTimer: number | null = null;
let countdownResolve: ((cancelled: boolean) => void) | null = null;

export function runCountdown(seconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    countdownResolve = resolve;
    setCountdown(seconds);
    countdownTimer = window.setInterval(() => {
      const next = (countdown() ?? 1) - 1;
      if (next <= 0) finishCountdown(false);
      else setCountdown(next);
    }, 1000);
  });
}

export function finishCountdown(cancelled: boolean) {
  if (countdownTimer != null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  setCountdown(null);
  const resolve = countdownResolve;
  countdownResolve = null;
  resolve?.(cancelled);
}

/** Cancel a pending start-timer countdown. */
export function cancelCountdown() {
  finishCountdown(true);
}
