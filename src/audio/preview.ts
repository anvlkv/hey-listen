import { invoke } from "../lib/ipc";
import { createEffect, createRoot, createSignal, on } from "solid-js";
import { channel, channelArg } from "../state/analysis";
import { analyzerBus } from "../state/chartSync";
import { filterRevision } from "../state/graph";
import { outputDeviceId } from "../state/output";
import { source } from "../state/source";
import { windowEnd, windowStart } from "../state/timeline";
import { createWindowFollow } from "./previewFollow";
import { createPositionTracker } from "./previewPosition";
import { clamp, type TransportRegion, type TransportStatus } from "./transport";
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
/** A filter/channel/device/speed edit landed while paused: reload on resume. */
let needsReload = false;
/** Latest-wins token: a superseded load must not stop (or report) a newer transport. */
let issueToken = 0;

/** Publish the playhead for the charts (`null` = no position). */
function publish(secs: number | null) {
  analyzerBus.setData("playhead", { secs });
}

/** Paint the frontend line: the position signal plus the chart bus. */
function paint(secs: number) {
  setPosition(secs);
  publish(secs);
}

/** The core cursor's frontend half: the poll, the interpolation and the end-of-region stop. */
const tracker = createPositionTracker({
  status,
  region,
  loop: () => regionLoop,
  speed: previewSpeed,
  publish: paint,
  onEnded(end) {
    setStatus("idle");
    publish(end);
  },
});

/** Keep a playing window preview on the analysis window as it moves. */
const follow = createWindowFollow({
  isPlaying: () => status() === "playing",
  loaded: region,
  refresh: () => refreshPreview(),
});

/**
 * Load the region (with `offset` source seconds into it) and start playing. The core
 * filters/resamples on load, so this is also how a live edit is re-applied.
 */
function issue(start: number, end: number, loopRegion: boolean, offset: number) {
  const token = ++issueToken;
  tracker.loading();
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
      tracker.reanchor(start + offset);
      tracker.loaded();
      // A load starts the core: honour a pause/stop that landed while it was in flight.
      if (status() === "paused") void invoke("pause_preview").catch(() => {});
      else if (status() === "idle") void invoke("stop_preview").catch(() => {});
    })
    .catch((err) => {
      // A newer load (or a stop) superseded this one: its result no longer applies.
      if (token !== issueToken) return;
      tracker.loaded();
      console.error("preview failed", err);
      setPreviewError(`Preview failed: ${String(err)}`);
      tracker.stop();
      setStatus("idle");
      publish(position());
      // A failed load may have left an older region running; make sure it is silent.
      void invoke("stop_preview").catch(() => {});
    });
}

/** Move to `at` and (re)start the timers. */
function begin(at: number) {
  tracker.reanchor(at);
  paint(at);
  setStatus("playing");
  tracker.start();
}

/**
 * Play `startSec..endSec` (source seconds), optionally looping. Restarting while already
 * playing replaces the current region (used for the edge excerpt and an explicit MCP
 * range). An explicit `speed` also sets the current rate.
 */
export function playRegion(startSec: number, endSec: number, loopFlag = true, speed?: number) {
  if (speed != null) setPreviewSpeed(speed);
  follow.active = false;
  follow.cancel();
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
  follow.active = true;
  follow.cancel();
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
  const at = tracker.interpolate();
  tracker.stop();
  setStatus("paused");
  tracker.reanchor(at);
  paint(at);
  void invoke("pause_preview").catch(() => {});
  // The local line can be a few ms ahead; adopt the core's exact cursor.
  void invoke<number | null>("preview_position")
    .then((seconds) => {
      if (status() !== "paused" || seconds == null) return;
      const exact = region().start + seconds;
      tracker.reanchor(exact);
      paint(exact);
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
  const at = status() === "playing" ? tracker.interpolate() : position();
  issueToken++;
  follow.cancel();
  follow.active = false;
  tracker.stop();
  setStatus("idle");
  tracker.reanchor(at);
  paint(at);
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
  tracker.reanchor(at);
  paint(at);
  if (status() !== "idle") {
    void invoke("seek_preview", { secs: at - region().start }).catch(() => {});
  }
}

/**
 * Put the playhead at the source start, stopping a transport whose loaded region excludes 0.
 *
 * The core cursor is region-relative (ADR-22), so a playing/paused region that starts later
 * than 0 has to be stopped before the line can sit at 0 — `seek` never leaves the loaded
 * region. A region that starts at 0 keeps playing, from the start.
 */
export function returnToStart(): void {
  if (status() !== "idle" && region().start > 1e-9) stop();
  seek(0);
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
  tracker.reanchor(start + offset);
  issue(start, end, regionLoop, offset);
}

/** Re-load the current region so the core re-reads the filter/channel/device/speed. */
function refreshPreview() {
  if (status() === "paused") {
    needsReload = true;
    return;
  }
  if (status() !== "playing") return;
  if (follow.active) {
    const start = windowStart();
    setRegion({ start, end: Math.max(start, windowEnd()) });
    regionLoop = loop();
  }
  reissueFrom(position());
}

/**
 * Clamp a paused/idle playhead into a moved analysis window (D-04): a line outside
 * `[start, end]` moves to the nearer edge.
 *
 * ADR-22: while paused the core cursor is relative to the loaded region, and that region is
 * still the old window, so `seek_preview` would be clamped back inside it. Adopt the new
 * window as the region and flag a reload instead — resume starts at the offset — moving only
 * the frontend position and anchor. Idle has no core cursor to respect, so `seek` (which
 * clamps to the source and writes the stopped core) is enough.
 */
function clampIntoWindow() {
  if (!source() || status() === "playing") return;
  const start = windowStart();
  const end = windowEnd();
  if (end - start <= 0) return;
  const at = position();
  if (at >= start && at <= end) return;
  const target = clamp(at, start, end);
  if (status() === "idle") {
    seek(target);
    return;
  }
  setRegion({ start, end });
  regionLoop = loop();
  needsReload = true;
  tracker.reanchor(target);
  paint(target);
}

/** Drop the transport when the source is replaced: nothing loaded, no playhead. */
function resetTransport() {
  issueToken++;
  follow.cancel();
  follow.active = false;
  needsReload = false;
  tracker.stop();
  tracker.reanchor(0);
  setStatus("idle");
  setPosition(0);
  setRegion({ start: 0, end: 0 });
  publish(source() ? 0 : null);
  void invoke("stop_preview").catch(() => {});
}

// Re-apply the region when anything that changes the *loaded* buffer changes, keep a
// window preview on the window as it moves, clamp a stopped playhead into a moved window,
// and clear the transport on a new source.
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
        if (previous) follow.onChange(previous);
      },
      { defer: true },
    ),
  );
  createEffect(on([windowStart, windowEnd], clampIntoWindow, { defer: true }));
  createEffect(on(source, resetTransport, { defer: true }));
});
