import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { computePeaks, type Peaks } from "../lib/waveform";
import { onDevicePixelRatioChange } from "../lib/devicePixelRatio";
import { stopFollowing } from "../state/capture";
import { filteredSamples } from "../state/filtered";
import { filterActive } from "../state/graph";
import {
  createAnnotation,
  defaultAnnotationTool,
  selectedAnnotationId,
  annotationsSorted,
} from "../state/annotations";
import { source, status } from "../state/source";
import { setView, viewEnd, viewStart, windowEnd, windowStart } from "../state/timeline";
import { PLOT_PAD, RAIL_W } from "./timeline/constants";
import ChannelRail from "./timeline/ChannelRail";
import { drawTimeline, type TimelineDrawDeps } from "./timeline/draw";
import { createTimelineInteraction } from "./timeline/interaction";
import { createPreview } from "./timeline/preview";
import TimelineToolbar from "./timeline/TimelineToolbar";
import TimelineScrollBar from "./timeline/ScrollBar";

/**
 * Timeline (fixed region): waveform of the whole source plus the draggable
 * analysis window.
 *
 * - Wheel zooms around the cursor, the middle button pans, buttons fit /
 *   zoom-to-window.
 * - A plain left drag in the waveform body **selects** a new window (text-like); the
 *   middle button pans. Dragging a `start`/`end` handle previews an excerpt at that edge
 *   and reframes on release (see `docs/source-model.md`).
 * - Dragging the grab bar along the top of the window moves the whole window,
 *   keeping its width (no edge excerpt or reframe; a preview that is playing
 *   reloads onto the new window when the move settles).
 * - A 2+ channel source shows the **channel rail** on the left, with one waveform lane
 *   per channel; the rail picks the shared analysis channel.
 *
 * The canvas painting, pointer interaction and toolbar live in sibling modules
 * under `./timeline/`; this component owns the state and composes them.
 */
export default function Timeline() {
  let canvas!: HTMLCanvasElement;
  let wrap!: HTMLDivElement;

  const [cssW, setCssW] = createSignal(0);
  const [cssH, setCssH] = createSignal(0);
  const [annotationHint, setAnnotationHint] = createSignal<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  const duration = () => source()?.duration ?? 0;
  const span = () => Math.max(1e-9, viewEnd() - viewStart());
  /** Width of the channel rail: only a 2+ channel source has one. */
  const railW = () => ((source()?.channels ?? 1) > 1 ? RAIL_W : 0);
  const plotW = () => Math.max(1, cssW() - PLOT_PAD * 2 - railW());
  /** Left edge of the plotted time axis (right of the rail). */
  const plotLeft = () => PLOT_PAD + railW();
  /** The timeline is interactive for a settled source or a growing capture. */
  const active = () => status() === "ready" || status() === "capturing";

  /** One envelope per source channel, for the parallel channel lanes. */
  const channelPeaks = createMemo<Peaks[]>(() => {
    const s = source();
    if (!s) return [];
    const lanes: Peaks[] = [];
    for (let c = 0; c < s.channels; c++) {
      // Live captures maintain peaks for one channel incrementally; files compute lazily.
      lanes.push(
        s.peaks && s.peaksChannel === c
          ? s.peaks
          : computePeaks(s.samples, s.frames, s.channels, c),
      );
    }
    return lanes;
  });

  /** Envelope of the filtered mono overlay (source rate; see `state/filtered.ts`). */
  const filteredPeaks = createMemo<Peaks | null>(() => {
    const f = filteredSamples();
    if (!f || f.length === 0) return null;
    return computePeaks(f, f.length, 1, "mix");
  });

  const t2x = (t: number) => plotLeft() + ((t - viewStart()) / span()) * plotW();
  const x2t = (x: number) => viewStart() + ((x - plotLeft()) / plotW()) * span();

  const clampView = (a: number, b: number): [number, number] => {
    const dur = duration();
    const minSpan = Math.min(dur, Math.max(1e-4, dur / 100_000));
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);
    if (hi - lo < minSpan) {
      const mid = (lo + hi) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    if (lo < 0) {
      hi = Math.min(dur, hi - lo);
      lo = 0;
    }
    if (hi > dur) {
      lo = Math.max(0, lo - (hi - dur));
      hi = dur;
    }
    return [Math.max(0, lo), Math.min(dur, hi)];
  };

  const applyView = (a: number, b: number) => {
    const [lo, hi] = clampView(a, b);
    setView(lo, hi);
  };

  /** Pan from the scrollbar, keeping the visible span (the clamp does the rest). */
  const scrollTo = (start: number) => {
    stopFollowing();
    applyView(start, start + span());
  };

  const preview = createPreview();

  /**
   * Drop a **point** annotation at the preview playhead — the cursor the user is
   * listening to. It takes the focused analyzer as its chart (like the Annotations
   * panel's `Add`) and, as always when creating, never moves the analysis window.
   */
  const annotationAtCursor = () => {
    const at = preview.playSec();
    if (at == null) return;
    createAnnotation({ timeSecs: at, tool: defaultAnnotationTool() });
  };

  const interaction = createTimelineInteraction({
    canvas: () => canvas,
    active,
    duration,
    t2x,
    x2t,
    span,
    plotW,
    applyView,
    setAnnotationHint,
    previewEdge: preview.previewEdge,
    endPreview: preview.endPreview,
  });

  const drawDeps: TimelineDrawDeps = {
    cssW,
    cssH,
    channelPeaks,
    filteredPeaks,
    railW,
    playSec: preview.playSec,
    playSecPlaying: () => preview.status() === "playing",
    t2x,
    x2t,
    span,
    plotW,
    laneSelection: interaction.selection,
    laneDrag: interaction.laneDrag,
    laneHover: interaction.laneHover,
  };

  function draw() {
    drawTimeline(canvas?.getContext("2d"), drawDeps);
  }

  // --- lifecycle ---------------------------------------------------------

  /** Fit the bitmap to the region and repaint (also guards against blanking). */
  function syncCanvasSize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    setCssW(rect.width);
    setCssH(rect.height);
    draw();
  }

  onMount(() => {
    const ro = new ResizeObserver(() => syncCanvasSize());
    ro.observe(wrap);
    syncCanvasSize();
    const stopDpr = onDevicePixelRatioChange(syncCanvasSize);
    canvas.addEventListener("wheel", interaction.onWheel, { passive: false });
    onCleanup(() => {
      ro.disconnect();
      stopDpr();
      canvas.removeEventListener("wheel", interaction.onWheel);
    });
  });

  onCleanup(() => preview.endPreview());

  createEffect(() => {
    // Track everything the canvas draws.
    source();
    status();
    cssW();
    cssH();
    viewStart();
    viewEnd();
    windowStart();
    windowEnd();
    preview.playSec();
    preview.status();
    filteredSamples();
    filterActive();
    annotationsSorted();
    selectedAnnotationId();
    interaction.laneHover();
    interaction.laneDrag();
    draw();
  });

  return (
    <section class="app-timeline" data-testid="region.timeline">
      <TimelineToolbar
        status={preview.status()}
        position={preview.playSec()}
        loop={preview.loop()}
        active={active()}
        canAnnotateAtCursor={preview.status() === "playing"}
        onToggle={preview.toggle}
        onStop={preview.stop}
        onToggleLoop={preview.toggleLoop}
        onAnnotateAtCursor={annotationAtCursor}
        onZoomWindow={interaction.zoomToWindow}
        onZoomOut={() => interaction.zoomBy(1.5)}
        onZoomIn={() => interaction.zoomBy(1 / 1.5)}
        onFit={interaction.fitAll}
      />

      <div class="timeline-canvas" ref={(node) => (wrap = node)}>
        <canvas
          ref={(node) => (canvas = node)}
          data-testid="timeline.canvas"
          onPointerDown={interaction.onPointerDown}
          onPointerMove={interaction.onPointerMove}
          onPointerUp={interaction.onPointerUp}
          onPointerCancel={interaction.onPointerUp}
          onPointerLeave={interaction.onPointerLeave}
        />
        <Show when={railW() > 0}>
          <ChannelRail />
        </Show>
        <Show when={!active()}>
          <div class="timeline-overlay">
            <Show when={status() === "empty"}>Open a file or record a source to begin</Show>
            <Show when={status() === "probing"}>Reading metadata…</Show>
            <Show when={status() === "decoding"}>Decoding audio…</Show>
            <Show when={status() === "error"}>
              <span class="timeline-error">Source failed — see the Source panel</span>
            </Show>
          </div>
        </Show>
        <Show when={annotationHint()}>
          {(hint) => (
            <div
              class="timeline-annotation-hint"
              data-testid="timeline.annotation.hint"
              style={{ left: `${hint().x + 10}px`, top: `${hint().y + 10}px` }}
            >
              {hint().text}
            </div>
          )}
        </Show>
      </div>
      <TimelineScrollBar
        view={() => [viewStart(), viewEnd()]}
        duration={duration}
        onScroll={scrollTo}
      />
    </section>
  );
}
