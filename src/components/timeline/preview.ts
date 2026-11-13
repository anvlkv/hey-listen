import { type Accessor } from "solid-js";
import {
  pause as pauseTransport,
  playRegion,
  playWindow,
  resume as resumeTransport,
  setTransportLoop,
  stop as stopTransport,
  transportLoop,
  transportPosition,
  transportStatus,
} from "../../audio/preview";
import type { TransportStatus } from "../../audio/transport";
import { source } from "../../state/source";
import { windowEnd, windowStart } from "../../state/timeline";
import { EDGE_EXCERPT } from "./constants";

/**
 * The Timeline's transport controller (M23): a thin view over the project transport
 * store (`audio/preview.ts`), which owns the status, the position and the core cursor.
 * It adds the Timeline's **edge excerpt** audition and the `playSec` accessor the canvas
 * and charts draw from. The transport keeps the playhead visible while paused/stopped;
 * it is `null` only when there is no source.
 */
export interface PreviewController {
  /** `idle` / `playing` / `paused` (drives the toolbar and the dimmed playhead). */
  status: Accessor<TransportStatus>;
  /** The playhead position in source seconds, or `null` without a source. */
  playSec: Accessor<number | null>;
  /** Whether the loaded region loops. */
  loop: Accessor<boolean>;
  startPreview: (start: number, end: number, loop: boolean) => void;
  previewEdge: (kind: "start" | "end") => void;
  endPreview: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Play/Pause: playing pauses, paused resumes, idle plays the analysis window. */
  toggle: () => void;
  toggleLoop: () => void;
}

export function createPreview(): PreviewController {
  const playSec = () => (source() ? transportPosition() : null);

  function startPreview(start: number, end: number, loop: boolean) {
    playRegion(start, end, loop);
  }

  /** Audition a short excerpt next to the handle being dragged. */
  function previewEdge(kind: "start" | "end") {
    const wLen = windowEnd() - windowStart();
    if (wLen <= 0) return;
    const len = Math.min(EDGE_EXCERPT, wLen);
    if (kind === "end") startPreview(windowEnd() - len, windowEnd(), true);
    else startPreview(windowStart(), windowStart() + len, true);
  }

  function toggle() {
    const state = transportStatus();
    if (state === "playing") pauseTransport();
    else if (state === "paused") resumeTransport();
    else playWindow();
  }

  return {
    status: transportStatus,
    playSec,
    loop: transportLoop,
    startPreview,
    previewEdge,
    // Releasing an edge handle silences the excerpt but keeps the line where it is.
    endPreview: stopTransport,
    pause: pauseTransport,
    resume: resumeTransport,
    stop: stopTransport,
    toggle,
    toggleLoop: () => setTransportLoop(!transportLoop()),
  };
}
