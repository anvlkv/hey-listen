import { createSignal, type Accessor } from "solid-js";
import { playhead, previewRegion, stop as stopPreview } from "../../audio/preview";
import { analyzerBus } from "../../state/chartSync";
import { windowEnd, windowStart } from "../../state/timeline";
import { EDGE_EXCERPT, PREVIEW_TICK_MS } from "./constants";

/** The Timeline's preview controller: auditions a region and exposes the playhead. */
export interface PreviewController {
  /** Whether a preview region is currently loaded (drives the play/stop button). */
  previewing: Accessor<boolean>;
  /** The playhead time (seconds) while previewing, else `null`. */
  playSec: Accessor<number | null>;
  startPreview: (start: number, end: number, loop: boolean) => void;
  previewEdge: (kind: "start" | "end") => void;
  endPreview: () => void;
  togglePreview: () => void;
}

/**
 * Preview playback for the analysis window. `tick` polls the audio engine's
 * playhead on a **timer** (not `requestAnimationFrame`), because the transport's position
 * is a *clock*, not a paint: rAF is suspended while the window is occluded, which froze
 * the position (and the drawn playhead, and the time a note-at-the-playhead lands on)
 * even though the core kept looping the audio. A `null` position means the core stopped
 * (ended or failed), which ends the preview.
 *
 * Each tick also publishes the position on the shared chart bus, so every time chart
 * draws the same playhead (M14 follow-up).
 */
export function createPreview(): PreviewController {
  const [previewing, setPreviewing] = createSignal(false);
  const [playSec, setPlaySec] = createSignal<number | null>(null);

  let timer: ReturnType<typeof setInterval> | undefined;

  /** Publish the playhead for the charts (`null` = stopped). */
  function publish(secs: number | null) {
    analyzerBus.setData("playhead", { secs });
  }

  function tick() {
    if (!previewing()) return;
    const position = playhead();
    setPlaySec(position);
    publish(position);
    // A null position means the core stopped (ended or failed) — end the preview.
    if (position == null) endPreview();
  }

  function startPreview(start: number, end: number, loop: boolean) {
    previewRegion(start, end, loop);
    setPreviewing(true);
    setPlaySec(start);
    publish(start);
    timer ??= setInterval(tick, PREVIEW_TICK_MS);
  }

  /** Audition a short excerpt next to the handle being dragged. */
  function previewEdge(kind: "start" | "end") {
    const wLen = windowEnd() - windowStart();
    if (wLen <= 0) return;
    const len = Math.min(EDGE_EXCERPT, wLen);
    if (kind === "end") startPreview(windowEnd() - len, windowEnd(), true);
    else startPreview(windowStart(), windowStart() + len, true);
  }

  function endPreview() {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    stopPreview();
    setPreviewing(false);
    setPlaySec(null);
    publish(null);
  }

  function togglePreview() {
    if (previewing()) endPreview();
    else startPreview(windowStart(), windowEnd(), true);
  }

  return { previewing, playSec, startPreview, previewEdge, endPreview, togglePreview };
}
