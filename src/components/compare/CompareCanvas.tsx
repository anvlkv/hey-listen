import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { beginFrame, drawTimeAxis } from "../analyzer/chartCanvas";
import { plotBox, type ChartSize, type PlotBox } from "../analyzer/chartGeometry";
import { activeThemeId } from "../../state/themes";
import type { CompareLiveHandle } from "../../state/compare/live";
import type { Span } from "../../state/compare/types";
import { drawLiveMarkers, drawWindowBand } from "./canvasOverlays";

/**
 * A lightweight time-axis canvas for the compare heatmap and note views (M25.A).
 *
 * The uPlot charts get sizing, axes, cursors and zoom from the wrapper + plugins; a
 * pixel heatmap can't, so this supplies just the parts those views need: a
 * DPR-aware canvas that follows its container, a themed frame, the time axis, and the
 * compare marks (B's window band, both playheads, B's cursor). It is deliberately
 * **read-only** — a compare view has no note lane and no reframe menu.
 */
export default function CompareCanvas(props: {
  class?: string;
  /** A test hook on the wrapper (the canvas itself is found under it). */
  testid?: string;
  /** The visible source-second span. */
  span: () => Span;
  /** Paint the plot content; the frame, marks and axis are handled here. */
  paint: (ctx: CanvasRenderingContext2D, box: PlotBox, span: Span) => void;
  live?: CompareLiveHandle;
  /** The reference's analysis window (the band), if the view has one. */
  bWindow?: () => Span | null;
  swapped?: boolean;
}) {
  const [wrap, setWrap] = createSignal<HTMLDivElement>();
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
  const [size, setSize] = createSignal<ChartSize>({ width: 0, height: 0 });

  onMount(() => {
    const initialWrap = wrap();
    const initialCanvas = canvas();
    if (!initialWrap || !initialCanvas) return;
    const sync = () => {
      const rect = initialWrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      initialCanvas.width = Math.max(1, Math.round(rect.width * dpr));
      initialCanvas.height = Math.max(1, Math.round(rect.height * dpr));
      setSize({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(initialWrap);
    sync();
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    // Keyed on the theme **id** so a theme switch repaints the canvas.
    activeThemeId();
    const { width, height } = size();
    const span = props.span();
    const ctx = beginFrame(canvas(), width, height);
    if (!ctx || !(span.end > span.start)) return;
    const box = plotBox(size());
    props.paint(ctx, box, span);
    if (props.bWindow) drawWindowBand(ctx, box, span, props.bWindow());
    drawLiveMarkers(ctx, box, span, props.live, props.swapped ?? false);
    drawTimeAxis(ctx, { t0: span.start, t1: span.end }, box);
  });

  return (
    <div class={`compare-canvas ${props.class ?? ""}`} ref={setWrap} data-testid={props.testid}>
      <canvas ref={setCanvas} />
    </div>
  );
}
