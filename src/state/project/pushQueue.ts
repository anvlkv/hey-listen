/**
 * The pure primitives behind the project-state push (`state/project/push.ts`): a
 * leading-edge/trailing coalescer and the remote-apply mute flag.
 *
 * No Solid, no Tauri and no DOM, so `src/tests/pushQueue.test.ts` drives the clock
 * directly (the vitest suites run in a `node` environment).
 */

/** The clock and timers a coalescer needs (injected so a test can control time). */
export interface PushTimer {
  /** A monotonic "now", in ms. */
  now(): number;
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** `performance.now()` + `setTimeout`: the production clock. */
const realTimer: PushTimer = {
  now: () => performance.now(),
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A mute flag whose holds are released individually. */
export interface Mute {
  /** Mute until the returned release is called (calling it twice is harmless). */
  hold(): () => void;
  readonly active: boolean;
}

/**
 * The **remote mute**: while a restore is being applied, a window must not push the
 * restored state back as a new edit (the successor to `history.ts`'s `applying`).
 */
export function createMute(): Mute {
  let depth = 0;
  return {
    hold() {
      depth += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        depth -= 1;
      };
    },
    get active() {
      return depth > 0;
    },
  };
}

export interface PusherOptions {
  /** The coalescing window, in ms (short enough that a drag still feels live). */
  throttleMs?: number;
  timer?: PushTimer;
  /** While true, `request()` is dropped: a restore is being applied. */
  muted?: () => boolean;
}

/** A coalescing sender: one call per gesture, always with the latest value. */
export interface Pusher {
  /** Signal a change: the leading edge sends at once, a burst sends once more. */
  request(): void;
  /** Send anything queued now and wait until `send` has run. */
  flush(): Promise<void>;
  /** Drop anything queued (a restore is being applied). */
  cancel(): void;
}

/**
 * Coalesce a burst of changes into one send.
 *
 * The first change of a burst sends immediately; further changes inside the throttle
 * window collapse into a single trailing send of the latest value, so the core still
 * sees the end state of a drag. `send` reads the state itself, so a queued send always
 * carries what is true when it runs rather than what was true when it was queued.
 */
export function createPusher(
  send: () => void | Promise<void>,
  options: PusherOptions = {},
): Pusher {
  const throttleMs = options.throttleMs ?? 60;
  const timer = options.timer ?? realTimer;
  const muted = options.muted ?? (() => false);

  let queued = false;
  let handle: unknown;
  let lastSent = Number.NEGATIVE_INFINITY;
  let running: Promise<void> | null = null;
  let again = false;

  /** Run `send`, serialized: a request while one is in flight runs once more after it. */
  function run(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await send();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function clearTimer() {
    if (handle === undefined) return;
    timer.clear(handle);
    handle = undefined;
  }

  function sendNow() {
    queued = false;
    lastSent = timer.now();
    void run();
  }

  return {
    request() {
      if (muted()) return;
      queued = true;
      const since = timer.now() - lastSent;
      if (since >= throttleMs) {
        clearTimer();
        sendNow();
        return;
      }
      if (handle !== undefined) return;
      handle = timer.set(() => {
        handle = undefined;
        if (queued) sendNow();
      }, throttleMs - since);
    },
    async flush() {
      clearTimer();
      if (!queued && !running) return;
      queued = false;
      lastSent = timer.now();
      await run();
    },
    cancel() {
      clearTimer();
      queued = false;
    },
  };
}
