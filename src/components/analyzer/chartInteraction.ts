import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
} from "solid-js";
import { analyzerBus } from "../../state/chartSync";
import { NOTE_STRIP_H } from "../notes/strip";
import { createLaneDrag, type LaneSelection } from "../notes/lane";
import { timeRangeLabel } from "./chartCommon";
import { laneNotes } from "./notePlugins";
import type { AnalyzerId } from "../../state/analyzer";
import type { ReframeTarget } from "./ReframeMenu";
import {
  plotBox,
  plotGeo,
  type ChartSize,
  type ChartView,
  type PlotBox,
  type PlotGeo,
  type TimeExtent,
} from "./chartGeometry";

/** The state and DOM handlers a heatmap needs for its pan / zoom / note interaction. */
export interface ChartInteraction<V extends ChartView, H> {
  /** Bind to the sizing wrapper (`ref`). */
  attachWrap: (element: HTMLDivElement) => void;
  /** Bind to the chart canvas (`ref`). */
  attachCanvas: (element: HTMLCanvasElement) => void;
  canvas: Accessor<HTMLCanvasElement | undefined>;
  size: Accessor<ChartSize>;
  /** The plot area inside the canvas. */
  box: Accessor<PlotBox>;
  view: Accessor<V | null>;
  hover: Accessor<H | null>;
  menu: Accessor<ReframeTarget | null>;
  setMenu: (value: ReframeTarget | null) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  zoomLabel: Accessor<string>;
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerLeave: () => void;
  onContextMenu: (event: MouseEvent) => void;
  /** The span being dragged out in the lane, for the chart to draw. */
  selection: Accessor<LaneSelection>;
}

/** The per-chart hooks the interaction needs, so one factory serves both heatmaps. */
export interface ChartInteractionOptions<V extends ChartView, H, R extends TimeExtent> {
  /** Stable id: the note tool and the `sourceId` published for time sync. */
  id: string;
  /** The current analysis result, or `null` when there is no data. */
  result: Accessor<R | null>;
  /** The full (unzoomed) view for a result. */
  fullView: (result: R) => V;
  /** Clamp a proposed view to the data extent. */
  clampView: (view: V, result: R) => V;
  /** Merge a shared time range into the current view (or `null` to ignore it). */
  applyShared: (current: V | null, x: [number, number], result: R) => V | null;
  /** Translate a view by a plot-relative pointer delta (fractions of the plot size). */
  pan: (view: V, dxFrac: number, dyFrac: number) => V;
  /**
   * Wheel zoom around a plot-relative pointer position (`xFrac` across, `yFrac` up
   * from the plot bottom). Returns the zoomed view and whether to publish its time
   * range, or `null` to ignore the gesture.
   */
  wheel: (
    view: V,
    xFrac: number,
    yFrac: number,
    factor: number,
    shift: boolean,
  ) => { view: V; publish: boolean } | null;
  /** Map a plot hit to this chart's hover readout. */
  pick: (geo: PlotGeo<V>) => H | null;
}

/**
 * The pan / wheel-zoom / note-drag / reframe interaction shared by the heatmap
 * charts (M15): one view signal kept across data refreshes and synced on the
 * shared `"time"` group, the pointer + wheel handlers, the reframe menu target,
 * and the canvas sizing. The charts supply the small per-tool differences (the
 * frequency axis, the hover readout) through [`ChartInteractionOptions`].
 */
export function createChartInteraction<V extends ChartView, H, R extends TimeExtent>(
  options: ChartInteractionOptions<V, H, R>,
): ChartInteraction<V, H> {
  const [size, setSize] = createSignal<ChartSize>({ width: 0, height: 0 });
  const [hover, setHoverRaw] = createSignal<H | null>(null);
  const [view, setViewRaw] = createSignal<V | null>(null);
  const [menu, setMenu] = createSignal<ReframeTarget | null>(null);
  // A generic view/hover can look like a function to `Setter`, so set via the updater form.
  const setView = (value: V | null) => setViewRaw(() => value);
  const setHover = (value: H | null) => setHoverRaw(() => value);
  const [wrap, setWrap] = createSignal<HTMLDivElement>();
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();

  let pan: { x: number; y: number; view: V } | null = null;
  /** Whether the note lane owns the current gesture. */
  let laneActive = false;

  /** The lane's gesture (drag a note handle, or select a span for a new note). */
  const lane = createLaneDrag(() => {
    const v = view();
    const b = box();
    const spanT = Math.max((v?.t1 ?? 0) - (v?.t0 ?? 0), 1e-9);
    const t0 = v?.t0 ?? 0;
    return {
      notes: () => laneNotes(options.id),
      // The lane's new notes belong to this chart (its id is an analyzer id).
      tool: () => options.id as AnalyzerId,
      timeAt: (time) => b.x + ((time - t0) / spanT) * b.width,
      timeFromX: (x) => t0 + ((x - b.x) / b.width) * spanT,
    };
  });

  const box = createMemo(() => plotBox(size()));

  // Keep the current zoom across a data refresh (a new analysis result must not
  // reset it); only fit the full window when there is no view yet.
  createEffect(
    on(options.result, (result) => {
      if (!result) {
        setView(null);
        return;
      }
      const current = untrack(view);
      setView(current ? options.clampView(current, result) : options.fullView(result));
    }),
  );

  // Follow the shared time range when another chart zooms it, and reset to the full
  // window when the shared view is cleared (the source changed). `view` is read
  // untracked so writing it here cannot re-trigger this effect.
  createEffect(() => {
    const shared = analyzerBus.data.view;
    const result = options.result();
    if (!result) return;
    if (shared == null) {
      setView(options.fullView(result));
      return;
    }
    if (shared.group !== "time" || shared.sourceId === options.id) return;
    const next = options.applyShared(untrack(view), shared.x, result);
    if (next) setView(next);
  });

  /** Apply a view locally and (optionally) publish its time range for sync. */
  function applyView(next: V, publishTime: boolean) {
    const result = options.result();
    if (!result) return;
    const clamped = options.clampView(next, result);
    setView(clamped);
    if (publishTime) {
      analyzerBus.setData("view", {
        sourceId: options.id,
        group: "time",
        x: [clamped.t0, clamped.t1],
      });
    }
  }

  /** Publish this chart's cursor, so the other time charts and the Timeline can show it. */
  function publishCursor(time: number | null) {
    analyzerBus.setData("cursorSync", { sourceId: options.id, group: "time", x: time });
  }

  function updateHover(event: PointerEvent) {
    const v = view();
    const el = canvas();
    if (!v || !el) {
      setHover(null);
      publishCursor(null);
      return;
    }
    const geo = plotGeo(el, box(), v, event.clientX, event.clientY);
    setHover(geo ? options.pick(geo) : null);
    publishCursor(geo ? geo.time : null);
  }

  function onPointerDown(event: PointerEvent) {
    // Pan with the primary button only, so right-click can open the reframe menu.
    if (event.button !== 0) return;
    const v = view();
    const el = canvas();
    if (!v || !el) return;
    // The note lane owns the bottom strip: grab a handle to move / resize a note, or
    // drag empty space to select a span for a new one.
    const b = box();
    const rect = el.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    if (
      localY >= b.y + b.height - NOTE_STRIP_H &&
      localY <= b.y + b.height &&
      lane.down(event.clientX - rect.left)
    ) {
      laneActive = true;
      el.setPointerCapture(event.pointerId);
      return;
    }
    pan = { x: event.clientX, y: event.clientY, view: v };
    el.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    // A lane gesture takes the pointer until it ends (the lane is also the pan surface's
    // neighbour, so the two never run at once).
    if (laneActive) {
      const v = view();
      const el = canvas();
      if (v && el) {
        const b = box();
        const rect = el.getBoundingClientRect();
        const span = Math.max(v.t1 - v.t0, 1e-9);
        lane.move(v.t0 + ((event.clientX - rect.left - b.x) / b.width) * span);
      }
      return;
    }
    if (pan) {
      const b = box();
      const dxFrac = (event.clientX - pan.x) / b.width;
      const dyFrac = (event.clientY - pan.y) / b.height;
      applyView(options.pan(pan.view, dxFrac, dyFrac), true);
    }
    updateHover(event);
  }

  function onPointerUp(event: PointerEvent) {
    const el = canvas();
    lane.up();
    laneActive = false;
    pan = null;
    if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  function onPointerLeave() {
    if (!pan) {
      setHover(null);
      publishCursor(null);
    }
  }

  function onWheel(event: WheelEvent) {
    const v = view();
    const el = canvas();
    if (!v || !el) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const b = box();
    const factor = event.deltaY < 0 ? 0.8 : 1.25;
    const xFrac = (event.clientX - rect.left - b.x) / b.width;
    const yFrac = (b.y + b.height - (event.clientY - rect.top)) / b.height;
    const next = options.wheel(v, xFrac, yFrac, factor, event.shiftKey);
    if (next) applyView(next.view, next.publish);
  }

  /** Right-click: reframe the timeline window from the time under the pointer. */
  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    const v = view();
    const el = canvas();
    if (!v || !el) return;
    const rect = el.getBoundingClientRect();
    const b = box();
    const x = event.clientX - rect.left;
    const time = v.t0 + ((x - b.x) / b.width) * (v.t1 - v.t0);
    // `top` / `height` are the plot area, so the callout marks the chart, not the screen.
    setMenu({
      x: event.clientX,
      y: event.clientY,
      time,
      top: rect.top + b.y,
      height: b.height,
    });
  }

  function zoomTime(factor: number) {
    const v = view();
    if (!v) return;
    const center = (v.t0 + v.t1) / 2;
    const half = ((v.t1 - v.t0) / 2) * factor;
    applyView({ ...v, t0: center - half, t1: center + half }, true);
  }

  function fit() {
    const result = options.result();
    if (result) applyView(options.fullView(result), true);
  }

  function syncSize() {
    const el = canvas();
    const node = wrap();
    if (!el || !node) return;
    const rect = node.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(1, Math.round(rect.width * dpr));
    el.height = Math.max(1, Math.round(rect.height * dpr));
    setSize({ width: rect.width, height: rect.height });
  }

  onMount(() => {
    const el = canvas();
    const node = wrap();
    if (!el || !node) return;
    const observer = new ResizeObserver(() => syncSize());
    observer.observe(node);
    syncSize();
    // Non-passive so the wheel can zoom instead of scrolling the page.
    el.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    });
  });

  return {
    attachWrap: (element) => setWrap(element),
    attachCanvas: (element) => setCanvas(element),
    canvas,
    size,
    box,
    view,
    hover,
    menu,
    setMenu,
    zoomIn: () => zoomTime(0.5),
    zoomOut: () => zoomTime(2),
    fit,
    zoomLabel: () => timeRangeLabel(view()),
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onContextMenu,
    selection: lane.selection,
  };
}
