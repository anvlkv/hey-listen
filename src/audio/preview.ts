import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { channel, channelArg } from "../state/analysis";
import { analyzerBus } from "../state/chartSync";
import { filterRevision } from "../state/graph";
import { outputDeviceId } from "../state/output";
import { source } from "../state/source";
import { windowEnd, windowStart } from "../state/timeline";
import {
  clamp,
  interpolate as interpolatePosition,
  type TransportRegion,
  type TransportStatus,
} from "./transport";
import { previewSpeed, setPreviewSpeed } from "./transportSpeed";

/**
 * The project **transport** (M23): play / pause / stop / seek over the Rust core
 * (ADR-9, ADR-22). The core owns the PCM, the filter graph, the output stream and the
 * cursor; this store owns the frontend's *status* and *position*:
 *
 * - **Play/Pause** is primary; **stop** silences but keeps the playhead. Play resumes
 *   inside the loaded region, else at the window start.
 * - **The position is authoritative in the core.** `preview_position` is polled (~12 Hz)
 *   to re-anchor a ~60 fps local interpolation, which rides the shared chart bus
 *   (`playhead`). The region is loaded with an `offset`, so a reload keeps the playhead.
 * - The core filters/resamples **on load**, so a filter/channel/device/speed edit
 *   re-issues the region while playing (or on resume); `playWindow` reloads a moved
 *   window at its settle, resuming at the equivalent position.
 *
 * **Speed** is varispeed only (pitch shifts; analysis is always 1×): the value lives in
 * `transportSpeed.ts`, the slider scale in `lib/previewSpeed.ts`. The owner is always
 * `"source"` for now; M22's synth audition adds the second owner on the same stream.
 */

/** Core position poll interval (ms): ~12.5 Hz, the authoritative cursor. */
const POLL_MS = 80;
/** Local interpolation / chart publish interval (ms): 60 fps drawing. */
const TICK_MS = 16;
/** Trailing debounce before a moved analysis window reloads the looped region, in ms. */
const FOLLOW_DEBOUNCE_MS = 200;

const [status, setStatus] = createSignal<TransportStatus>("idle");
const [position, setPosition] = createSignal(0);
const [region, setRegion] = createSignal<TransportRegion>({ start: 0, end: 0 });
const [loop, setLoopSignal] = createSignal(true);

export { loop as transportLoop, position as transportPosition, status as transportStatus };

/**
 * The last transport failure (no output device, device busy, no source, …), or `null`.
 * Cleared when the next region load is attempted, so the toolbar error disappears as
 * soon as the user retries (and reappears only if that attempt fails too).
 */
export const [previewError, setPreviewError] = createSignal<string | null>(null);

/** Whether the loaded region loops (a per-region flag; `loop` is the user preference). */
let regionLoop = true;
/** Whether the loaded region tracks the analysis window (see `playWindow`). */
let followWindow = false;
let followTimer: ReturnType<typeof setTimeout> | undefined;
/** A filter/channel/device/speed edit landed while paused: reload on resume. */
let needsReload = false;
/** Latest-wins token: a superseded load must not stop (or report) a newer transport. */
let issueToken = 0;
/** Guards a poll response against a region load that superseded its request. */
let loadGeneration = 0;
/** A load is in flight: the core's cursor still belongs to the previous region. */
let loadSettled = true;
/** The core position at `anchorAt`, for the local interpolation. */
let anchorSecs = 0;
let anchorAt = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;

/** Publish the playhead for the charts (`null` = no position). */
function publish(secs: number | null) {
  analyzerBus.setData("playhead", { secs });
}

/** The source seconds the line should be at now (interpolated while playing). */
function interpolate(): number {
  return interpolatePosition({
    status: status(),
    region: region(),
    anchor: { secs: anchorSecs, at: anchorAt },
    speed: previewSpeed(),
    loop: regionLoop,
    now: performance.now(),
  });
}

function startTimers() {
  tickTimer ??= setInterval(tick, TICK_MS);
  pollTimer ??= setInterval(poll, POLL_MS);
}

function stopTimers() {
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
  if (status() !== "playing") return;
  const at = interpolate();
  setPosition(at);
  publish(at);
  if (!regionLoop && at >= region().end - 1e-9) {
    stopTimers();
    setStatus("idle");
    publish(region().end);
  }
}

/** Re-anchor the interpolation on the core's authoritative cursor. */
function poll() {
  if (status() !== "playing" || !loadSettled) return;
  const generation = loadGeneration;
  void invoke<number | null>("preview_position")
    .then((seconds) => {
      if (status() !== "playing" || generation !== loadGeneration) return;
      if (seconds == null) return;
      anchorSecs = region().start + seconds;
      anchorAt = performance.now();
    })
    .catch(() => {});
}

/**
 * Load the region (with `offset` source seconds into it) and start playing. The core
 * filters/resamples on load, so this is also how a live edit is re-applied.
 */
function issue(start: number, end: number, loopRegion: boolean, offset: number) {
  const token = ++issueToken;
  loadGeneration++;
  loadSettled = false;
  setPreviewError(null);
  void invoke("preview_region", {
    start,
    end,
    loopRegion,
    channel: channelArg(channel()),
    device: outputDeviceId(),
    speed: previewSpeed(),
    offset,
  })
    .then(() => {
      if (token !== issueToken) return;
      anchorSecs = start + offset;
      anchorAt = performance.now();
      loadSettled = true;
      // A load starts the core: honour a pause/stop that landed while it was in flight.
      if (status() === "paused") void invoke("pause_preview").catch(() => {});
      else if (status() === "idle") void invoke("stop_preview").catch(() => {});
    })
    .catch((err) => {
      // A newer load (or a stop) superseded this one: its result no longer applies.
      if (token !== issueToken) return;
      loadSettled = true;
      console.error("preview failed", err);
      setPreviewError(`Preview failed: ${String(err)}`);
      stopTimers();
      setStatus("idle");
      publish(position());
      // A failed load may have left an older region running; make sure it is silent.
      void invoke("stop_preview").catch(() => {});
    });
}

/** Move to `at` and (re)start the timers. */
function begin(at: number) {
  anchorSecs = at;
  anchorAt = performance.now();
  setPosition(at);
  setStatus("playing");
  startTimers();
  publish(at);
}

/**
 * Play `startSec..endSec` (source seconds), optionally looping. Restarting while already
 * playing replaces the current region (used for the edge excerpt and an explicit MCP
 * range). An explicit `speed` also sets the current rate.
 */
export function playRegion(startSec: number, endSec: number, loopFlag = true, speed?: number) {
  if (speed != null) setPreviewSpeed(speed);
  followWindow = false;
  cancelFollow();
  const start = Math.max(0, Math.min(startSec, endSec));
  const end = Math.max(start, endSec);
  setRegion({ start, end });
  regionLoop = loopFlag;
  begin(start);
  issue(start, end, loopFlag, 0);
}

/**
 * Play the analysis window and keep the region on it: moving the window — by the
 * Timeline's move handle, a chart's *Reframe* menu, Analyze, or MCP `set_window` — reloads
 * the region once the move settles, resuming at the equivalent position. Play resumes
 * from the current position when it is inside the window, else from the window start.
 */
export function playWindow() {
  const start = windowStart();
  const end = Math.max(start, windowEnd());
  followWindow = true;
  cancelFollow();
  setRegion({ start, end });
  regionLoop = loop();
  const inside = position() >= start && position() < end;
  const offset = inside ? position() - start : 0;
  begin(start + offset);
  issue(start, end, regionLoop, offset);
}

/** Pause at the current position (silence, cursor kept). */
export function pause() {
  if (status() !== "playing") return;
  const at = interpolate();
  stopTimers();
  setStatus("paused");
  setPosition(at);
  anchorSecs = at;
  anchorAt = performance.now();
  publish(at);
  void invoke("pause_preview").catch(() => {});
  // The local line can be a few ms ahead; adopt the core's exact cursor.
  void invoke<number | null>("preview_position")
    .then((seconds) => {
      if (status() !== "paused" || seconds == null) return;
      const exact = region().start + seconds;
      anchorSecs = exact;
      setPosition(exact);
      publish(exact);
    })
    .catch(() => {});
}

/** Resume a paused region; from idle, this starts the window preview. */
export function resume() {
  if (status() === "idle") {
    playWindow();
    return;
  }
  if (status() !== "paused") return;
  if (needsReload) {
    // The filter/channel/device/speed changed while paused: reload from the cursor.
    needsReload = false;
    const { start, end } = region();
    const offset = clamp(position() - start, 0, end - start);
    begin(start + offset);
    issue(start, end, regionLoop, offset);
    return;
  }
  begin(position());
  void invoke("resume_preview").catch(() => {});
}

/** Silence the transport, keeping the playhead where it is. */
export function stop() {
  const at = status() === "playing" ? interpolate() : position();
  issueToken++;
  cancelFollow();
  followWindow = false;
  stopTimers();
  setStatus("idle");
  setPosition(at);
  anchorSecs = at;
  publish(at);
  void invoke("stop_preview").catch(() => {});
}

/** Move the playhead to `secs` (source seconds), clamped into the region or the source. */
export function seek(secs: number) {
  const duration = source()?.duration ?? 0;
  let at = Number.isFinite(secs) ? Math.max(0, secs) : 0;
  if (status() !== "idle") {
    // The core cursor lives inside the loaded region; keep the two in agreement.
    const { start, end } = region();
    at = clamp(at, start, end);
  } else if (duration > 0) {
    at = Math.min(at, duration);
  }
  anchorSecs = at;
  anchorAt = performance.now();
  setPosition(at);
  publish(at);
  if (status() !== "idle") {
    void invoke("seek_preview", { secs: at - region().start }).catch(() => {});
  }
}

/** Set the loop preference. A change while a region is loaded re-issues it. */
export function setTransportLoop(enabled: boolean) {
  setLoopSignal(enabled);
  regionLoop = enabled;
  if (status() === "paused") {
    needsReload = true;
    return;
  }
  if (status() === "playing") reissueFrom(position());
}

/** Re-load the current region starting at `at` (source seconds). */
function reissueFrom(at: number) {
  const { start, end } = region();
  const offset = clamp(at - start, 0, end - start);
  anchorSecs = start + offset;
  anchorAt = performance.now();
  issue(start, end, regionLoop, offset);
}

/** Re-load the current region so the core re-reads the filter/channel/device/speed. */
function refreshPreview() {
  if (status() === "paused") {
    needsReload = true;
    return;
  }
  if (status() !== "playing") return;
  if (followWindow) {
    const start = windowStart();
    const end = Math.max(start, windowEnd());
    setRegion({ start, end });
    regionLoop = loop();
    reissueFrom(position());
    return;
  }
  reissueFrom(position());
}

function cancelFollow() {
  if (followTimer !== undefined) {
    clearTimeout(followTimer);
    followTimer = undefined;
  }
}

/**
 * Reload a window-following preview when the window settles (debounced like the analysis
 * auto-run): a window preview, or one playing **exactly** the moved window — not a sub-range.
 */
function followWindowChange(previous: readonly number[]): void {
  if (status() !== "playing") return;
  const loaded = region();
  const onWindow =
    followWindow ||
    (Math.abs(loaded.start - previous[0]) < 1e-6 && Math.abs(loaded.end - previous[1]) < 1e-6);
  if (!onWindow) return;
  followWindow = true;
  cancelFollow();
  followTimer = setTimeout(() => {
    followTimer = undefined;
    if (status() !== "playing" || !followWindow) return;
    refreshPreview();
  }, FOLLOW_DEBOUNCE_MS);
}

/** Drop the transport when the source is replaced: nothing loaded, no playhead. */
function resetTransport() {
  issueToken++;
  cancelFollow();
  followWindow = false;
  needsReload = false;
  stopTimers();
  setStatus("idle");
  setPosition(0);
  setRegion({ start: 0, end: 0 });
  anchorSecs = 0;
  anchorAt = performance.now();
  publish(source() ? 0 : null);
  void invoke("stop_preview").catch(() => {});
}

// Re-apply the region when anything that changes the *loaded* buffer changes, keep a
// window preview on the window as it moves, and clear the transport on a new source.
createRoot(() => {
  createEffect(
    on([channel, filterRevision, outputDeviceId, previewSpeed], () => refreshPreview(), {
      defer: true,
    }),
  );
  createEffect(
    on(
      [windowStart, windowEnd],
      (_now, previous) => {
        if (previous) followWindowChange(previous);
      },
      { defer: true },
    ),
  );
  createEffect(on(source, resetTransport, { defer: true }));
});
