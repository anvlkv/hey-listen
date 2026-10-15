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
import { dragNoteTo, refreshNoteValues } from "../../state/notes";
import { NOTE_STRIP_H } from "../notes/strip";
import { timeRangeLabel } from "./chartCommon";
import { noteGroups, noteNear } from "./notePlugins";
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
  let noteDrag: { id: string } | null = null;

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

  function updateHover(event: PointerEvent) {
    const v = view();
    const el = canvas();
    if (!v || !el) {
      setHover(null);
      return;
    }
    const geo = plotGeo(el, box(), v, event.clientX, event.clientY);
    setHover(geo ? options.pick(geo) : null);
  }

  function onPointerDown(event: PointerEvent) {
    // Pan with the primary button only, so right-click can open the reframe menu.
    if (event.button !== 0) return;
    const v = view();
    const el = canvas();
    if (!v || !el) return;
    // Grab a note on its anchor in the bottom strip to drag it along time.
    const b = box();
    const rect = el.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const stripTop = b.y + b.height - NOTE_STRIP_H;
    if (localY >= stripTop && localY <= b.y + b.height) {
      const span = Math.max(v.t1 - v.t0, 1e-9);
      const note = noteNear(
        noteGroups(options.id),
        (t) => b.x + ((t - v.t0) / span) * b.width,
        event.clientX - rect.left,
      );
      if (note) {
        noteDrag = { id: note.id };
        el.setPointerCapture(event.pointerId);
        return;
      }
    }
    pan = { x: event.clientX, y: event.clientY, view: v };
    el.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (noteDrag) {
      const v = view();
      const el = canvas();
      if (v && el) {
        const b = box();
        const rect = el.getBoundingClientRect();
        const span = Math.max(v.t1 - v.t0, 1e-9);
        const time = v.t0 + ((event.clientX - rect.left - b.x) / b.width) * span;
        dragNoteTo(noteDrag.id, time);
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
    if (noteDrag) {
      refreshNoteValues(noteDrag.id);
      noteDrag = null;
    }
    pan = null;
    if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  function onPointerLeave() {
    if (!pan) setHover(null);
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
    setMenu({ x: event.clientX, y: event.clientY, time });
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
  };
}
