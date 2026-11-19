import { invoke } from "../lib/ipc";
import {
  interpolate as interpolatePosition,
  type TransportRegion,
  type TransportStatus,
} from "./transport";

/** Core position poll interval (ms): ~12.5 Hz, the authoritative cursor. */
const POLL_MS = 80;
/** Local interpolation / chart publish interval (ms): 60 fps drawing. */
const TICK_MS = 16;

/** The frontend half of the core cursor: the anchor, its timers, and the load generation. */
export interface PositionTracker {
  /** The source seconds the line should be at now (interpolated while playing). */
  interpolate(): number;
  /** Re-anchor the line on `secs` (source seconds) at the current instant. */
  reanchor(secs: number): void;
  /** A region load is in flight: the core's cursor still belongs to the previous region. */
  loading(): void;
  /** The load settled: polls may re-anchor on the new region again. */
  loaded(): void;
  /** Start the poll and paint intervals (idempotent). */
  start(): void;
  /** Stop both intervals. */
  stop(): void;
}

/**
 * The frontend's half of the transport cursor (M23, ADR-22). The core owns the real cursor,
 * but it is polled ~12.5 Hz, so `interpolate` extends the last authoritative anchor at the
 * playback speed for ~60 fps drawing, wrapping inside the looped region. The transport store
 * (`preview.ts`) owns the status, the region and the commands; this module owns the anchor,
 * the load generation and the two intervals.
 */
export function createPositionTracker(deps: {
  /** The state the line is drawn for. */
  status: () => TransportStatus;
  /** The region loaded in the core, in source seconds. */
  region: () => TransportRegion;
  /** Whether the loaded region loops. */
  loop: () => boolean;
  /** The varispeed rate the core is playing at. */
  speed: () => number;
  /** Publish a position (the `position` signal and the chart bus). */
  publish: (secs: number) => void;
  /** A non-looping region reached its end: the transport is idle at `end`. */
  onEnded: (end: number) => void;
}): PositionTracker {
  let anchorSecs = 0;
  let anchorAt = 0;
  /** Guards a poll response against a region load that superseded its request. */
  let generation = 0;
  let settled = true;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;

  /** The source seconds the line should be at now. */
  function interpolate(): number {
    return interpolatePosition({
      status: deps.status(),
      region: deps.region(),
      anchor: { secs: anchorSecs, at: anchorAt },
      speed: deps.speed(),
      loop: deps.loop(),
      now: performance.now(),
    });
  }

  function stop() {
    if (tickTimer !== undefined) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
    if (pollTimer !== undefined) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  /** Paint the interpolated position; a non-looping region stops at its end. */
  function tick() {
    if (deps.status() !== "playing") return;
    const at = interpolate();
    deps.publish(at);
    if (!deps.loop() && at >= deps.region().end - 1e-9) {
      stop();
      deps.onEnded(deps.region().end);
    }
  }

  /** Re-anchor the interpolation on the core's authoritative cursor. */
  function poll() {
    if (deps.status() !== "playing" || !settled) return;
    const requested = generation;
    void invoke<number | null>("preview_position")
      .then((seconds) => {
        if (deps.status() !== "playing" || requested !== generation) return;
        if (seconds == null) return;
        anchorSecs = deps.region().start + seconds;
        anchorAt = performance.now();
      })
      .catch(() => {});
  }

  return {
    interpolate,
    reanchor(secs) {
      anchorSecs = secs;
      anchorAt = performance.now();
    },
    loading() {
      generation++;
      settled = false;
    },
    loaded() {
      settled = true;
    },
    start() {
      tickTimer ??= setInterval(tick, TICK_MS);
      pollTimer ??= setInterval(poll, POLL_MS);
    },
    stop,
  };
}
