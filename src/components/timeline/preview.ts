import { createSignal, type Accessor } from "solid-js";
import { playhead, previewRegion, stop as stopPreview } from "../../audio/preview";
import { analyzerBus } from "../../state/chartSync";
import { windowEnd, windowStart } from "../../state/timeline";
import { EDGE_EXCERPT } from "./constants";

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
 * playhead every frame so the canvas can draw it; a `null` position means the core
 * stopped (ended or failed), which ends the preview.
 *
 * Each tick also publishes the position on the shared chart bus, so every time chart
 * draws the same playhead (M14 follow-up).
 */
export function createPreview(): PreviewController {
  const [previewing, setPreviewing] = createSignal(false);
  const [playSec, setPlaySec] = createSignal<number | null>(null);

  let raf = 0;

  /** Publish the playhead for the charts (`null` = stopped). */
  function publish(secs: number | null) {
    analyzerBus.setData("playhead", { secs });
  }

  function tick() {
    raf = 0;
    if (!previewing()) return;
    const position = playhead();
    setPlaySec(position);
    publish(position);
    // A null position means the core stopped (ended or failed) — end the preview.
    if (position == null) {
      endPreview();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function startPreview(start: number, end: number, loop: boolean) {
    previewRegion(start, end, loop);
    setPreviewing(true);
    setPlaySec(start);
    publish(start);
    if (!raf) raf = requestAnimationFrame(tick);
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
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
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
