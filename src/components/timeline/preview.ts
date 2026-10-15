import { createSignal, type Accessor } from "solid-js";
import { playhead, previewRegion, stop as stopPreview } from "../../audio/preview";
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
 */
export function createPreview(): PreviewController {
  const [previewing, setPreviewing] = createSignal(false);
  const [playSec, setPlaySec] = createSignal<number | null>(null);

  let raf = 0;

  function tick() {
    raf = 0;
    if (!previewing()) return;
    const position = playhead();
    setPlaySec(position);
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
  }

  function togglePreview() {
    if (previewing()) endPreview();
    else startPreview(windowStart(), windowEnd(), true);
  }

  return { previewing, playSec, startPreview, previewEdge, endPreview, togglePreview };
}
