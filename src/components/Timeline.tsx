import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type JSX,
} from "solid-js";
import { transportFollow } from "../audio/transportFollow";
import { transportPosition } from "../audio/preview";
import { channel } from "../state/analysis";
import { computePeaks, type Peaks } from "../lib/waveform";
import { onDevicePixelRatioChange } from "../lib/devicePixelRatio";
import { stopFollowing } from "../state/capture";
import { filteredPcm } from "../state/filtered";
import { filterActive } from "../state/graph";
import {
  createAnnotation,
  defaultAnnotationTool,
  selectedAnnotationId,
  annotationsSorted,
} from "../state/annotations";
import { source, status } from "../state/source";
import { setView, viewEnd, viewStart, windowEnd, windowStart } from "../state/timeline";
import { clampViewRange } from "../state/timelineView";
import { createTimelineAccessibility } from "./timeline/accessibility";
import { PLOT_PAD, RAIL_W } from "./timeline/constants";
import ChannelRail from "./timeline/ChannelRail";
import {
  createFilteredLanes,
  laneChannels as laneChannelsFor,
  laneFilterOutputs,
} from "./timeline/filteredLanes";
import TimelineContextMenu from "./timeline/TimelineContextMenu";
import { drawTimeline, type TimelineDrawDeps } from "./timeline/draw";
import { niceStep } from "./timeline/format";
import { createTimelineInteraction } from "./timeline/interaction";
import { createPreview } from "./timeline/preview";
import { clampTime } from "./timeline/selection";
import { snapEnabled, snapMove, snapSpan, snapTime, type SnapOptions } from "./timeline/snapping";
import TimelineToolbar from "./timeline/TimelineToolbar";
import TimelineScrollBar from "./timeline/ScrollBar";

/**
 * Timeline (fixed region): waveform of the whole source plus the draggable
 * analysis window.
 *
 * - Wheel zooms around the cursor (a horizontal wheel or Shift+wheel pans), the middle
 *   button pans, buttons fit / zoom-to-window.
 * - A plain left drag in the waveform body **selects** a new window (text-like); a ruler
 *   drag does too, while a ruler click seeks. The middle button pans. Dragging a
 *   `start`/`end` handle previews an excerpt at that edge
 * and reframes on release.
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
  /** Lanes shown: the filter graph's outputs when it is applied, else the source channels. */
  const laneChannels = () => laneChannelsFor(source()?.channels ?? 1);
  /** Width of the channel rail: only a 2+ lane view has one. */
  const railW = () => (laneChannels() > 1 ? RAIL_W : 0);
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

  /** One envelope per filter output channel, for the lanes a filter draws. */
  const filteredLanes = createFilteredLanes();

  const t2x = (t: number) => plotLeft() + ((t - viewStart()) / span()) * plotW();
  const x2t = (x: number) => viewStart() + ((x - plotLeft()) / plotW()) * span();

  /** The source time under a client x, clamped to the source (the context menu's anchor). */
  const timeAt = (clientX: number) => {
    const rect = canvas.getBoundingClientRect();
    return clampTime(x2t(clientX - rect.left), duration());
  };

  const clampView = (a: number, b: number) => clampViewRange(a, b, duration());

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
  const a11y = createTimelineAccessibility({ status: preview.status });

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

  /**
   * The snap targets for the **current gesture** (D-12), captured on its first snap and
   * dropped by the next pointer-down. The window is mid-gesture state: its live edges would
   * sit right under the pointer and pin a move or a selection, so the snapshot has to predate
   * the gesture's own writes.
   */
  let gestureSnap: SnapOptions | null = null;
  const snapOpts = (): SnapOptions =>
    (gestureSnap ??= {
      candidates: [
        0,
        duration(),
        transportPosition(),
        windowStart(),
        windowEnd(),
        ...annotationsSorted().flatMap((a) =>
          a.range ? [a.range.startSecs, a.range.endSecs] : [a.timeSecs],
        ),
      ],
      tolerance: (span() / plotW()) * 8,
      grid: niceStep(span(), plotW()),
      duration: duration(),
    });

  const interaction = createTimelineInteraction({
    canvas: () => canvas,
    active,
    duration,
    laneChannels,
    t2x,
    x2t,
    span,
    plotW,
    applyView,
    snapTime: (t) => (snapEnabled() ? snapTime(t, snapOpts()) : t),
    snapSpan: (a, b) =>
      snapEnabled() ? snapSpan(a, b, snapOpts()) : { start: Math.min(a, b), end: Math.max(a, b) },
    snapMove: (start, width) => (snapEnabled() ? snapMove(start, width, snapOpts()) : start),
    setAnnotationHint,
    previewEdge: preview.previewEdge,
    endPreview: preview.endPreview,
  });

  /** Drop the gesture's snap snapshot, then hand the press to the pointer interaction. */
  const onPointerDown = (event: PointerEvent) => {
    gestureSnap = null;
    interaction.onPointerDown(event);
  };

  const drawDeps: TimelineDrawDeps = {
    cssW,
    cssH,
    filteredLanes,
    channelPeaks,
    laneChannels,
    railW,
    playSec: preview.playSec,
    playSecPlaying: () => preview.status() === "playing",
    t2x,
    x2t,
    span,
    plotW,
    laneSelection: interaction.selection,
    windowSelection: interaction.windowSelection,
    laneDrag: interaction.laneDrag,
    laneHover: interaction.laneHover,
    hoverTime: interaction.hoverTime,
    hoverX: interaction.hoverX,
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
    channel();
    filteredPcm();
    filterActive();
    annotationsSorted();
    selectedAnnotationId();
    interaction.laneHover();
    interaction.laneDrag();
    interaction.windowSelection();
    interaction.hoverTime();
    interaction.hoverX();
    draw();
  });

  /**
   * Follow the playhead (D-03): while playing with the toggle on, page the view by its own
   * span so the line never runs off the edge. The new view keeps ~8% of the span as a
   * margin — on the left when the playhead went backwards, on the right when it went
   * forwards — and `applyView` clamps it to the source. The bounds are read untracked so a
   * view write cannot re-trigger this effect.
   */
  createEffect(
    on([preview.playSec, preview.status, transportFollow], () => {
      const at = preview.playSec();
      if (!transportFollow() || preview.status() !== "playing" || !source() || at == null) {
        return;
      }
      const [lo, hi] = untrack(() => [viewStart(), viewEnd()] as const);
      if (at >= lo && at <= hi) return;
      const pad = Math.max(1e-9, hi - lo) * 0.08;
      if (at < lo) applyView(at - pad, at - pad + (hi - lo));
      else applyView(at + pad - (hi - lo), at + pad);
    }),
  );

  /**
   * The hover hint chip: kept 10px clear of the pointer, flipped left past 60% of the
   * width and above past 60% of the height so it never runs off the region, and capped
   * to the room on that side so its wrapping text stays inside.
   */
  const hintStyle = (hint: { x: number; y: number }): JSX.CSSProperties => {
    const w = cssW();
    const h = cssH();
    const flipLeft = hint.x > w * 0.6;
    const flipUp = hint.y > h * 0.6;
    const room = flipLeft ? hint.x - 20 : w - hint.x - 20;
    const style: JSX.CSSProperties = { "max-width": `${Math.max(80, Math.min(320, room))}px` };
    if (flipLeft) style.right = `${Math.max(10, w - hint.x + 10)}px`;
    else style.left = `${hint.x + 10}px`;
    if (flipUp) style.bottom = `${Math.max(10, h - hint.y + 10)}px`;
    else style.top = `${hint.y + 10}px`;
    return style;
  };

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

      <TimelineContextMenu
        ref={(node) => (wrap = node)}
        timeAt={timeAt}
        onZoomWindow={interaction.zoomToWindow}
        onFit={interaction.fitAll}
      >
        <canvas
          ref={(node) => (canvas = node)}
          data-testid="timeline.canvas"
          tabIndex={0}
          role="application"
          aria-roledescription="interactive timeline"
          aria-label="Timeline: waveform, analysis window and playhead"
          aria-describedby="timeline-keyboard-help"
          onPointerDown={onPointerDown}
          onPointerMove={interaction.onPointerMove}
          onPointerUp={interaction.onPointerUp}
          onPointerCancel={interaction.onPointerUp}
          onPointerLeave={interaction.onPointerLeave}
        />
        <Show when={railW() > 0}>
          <ChannelRail channels={laneChannels()} filterOutputs={laneFilterOutputs()} />
        </Show>
        <Show when={!active()}>
          <div class="timeline-overlay" data-testid="timeline.empty">
            <Show when={status() === "empty"}>
              Open a file or record a source in Sources to begin
            </Show>
            <Show when={status() === "probing"}>Reading metadata…</Show>
            <Show when={status() === "decoding"}>Decoding audio…</Show>
            <Show when={status() === "error"}>
              <span class="timeline-error">Source failed — see Sources</span>
            </Show>
          </div>
        </Show>
        <Show when={annotationHint()}>
          {(hint) => (
            <div
              class="timeline-annotation-hint"
              data-testid="timeline.annotation.hint"
              style={hintStyle(hint())}
            >
              {hint().text}
            </div>
          )}
        </Show>
      </TimelineContextMenu>
      <p id="timeline-keyboard-help" class="timeline-sr">
        Left and right arrows move the playhead by one grid step (Shift for ten); Home returns to
        the start; End jumps to the end; PageUp and PageDown step through the analysis-window
        history.
      </p>
      <p
        class="timeline-sr"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="timeline.announce"
      >
        {a11y.announcement()}
      </p>
      <TimelineScrollBar
        view={() => [viewStart(), viewEnd()]}
        duration={duration}
        onScroll={scrollTo}
      />
    </section>
  );
}
