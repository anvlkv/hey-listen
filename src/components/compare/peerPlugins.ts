import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import { chartTheme } from "../../state/themes";
import type { AnalyzerBus } from "../../state/chartSync";
import type { LiveSideDto, Span } from "../../state/compare/types";

/** The uPlot instance type, taken from the wrapper's plugin props. */
type Uplot = TooltipProps["u"];

/**
 * The compare view's peer markers (M25).
 *
 * One plugin draws everything that belongs to the **reference** project on the owner's
 * chart: its dashed cursor (a time, frequency or modulation-rate value), its playhead
 * (dashed, read from the core — a popout has no Timeline to publish one), and its
 * analysis window as a faint band. A's own playhead is drawn solid, so "where each
 * project is playing" is readable at a glance on a time chart.
 *
 * Repaints on each polled change with `u.redraw()` (not `redraw(false)`, which only
 * commits and is a no-op unless a scale change is pending).
 */
export function compareMarkers(props: {
  a: () => LiveSideDto;
  b: () => LiveSideDto;
  /** The reference's analysis window; drawn as a band on time charts. */
  window: () => Span | null;
  /** Which axis B's cursor belongs to. */
  axis: "time" | "freq" | "rate";
}): UplotPluginFactory<AnalyzerBus> {
  return () => {
    let dispose: (() => void) | undefined;
    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            createEffect(() => {
              props.a();
              props.b();
              props.window();
              u.redraw();
            });
            return root;
          });
        },
        draw: (u) => {
          if (props.axis === "time") {
            drawBand(u, props.window());
            drawPlayheads(u, props.a(), props.b());
          }
          drawPeerCursor(u, props.b(), props.axis);
        },
        destroy: () => dispose?.(),
      },
    };
  };
}

/** The reference's analysis window as a faint band (time charts only). */
function drawBand(u: Uplot, span: Span | null) {
  if (!span) return;
  const x0 = u.valToPos(span.start, "x", true);
  const x1 = u.valToPos(span.end, "x", true);
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return;
  const { ctx } = u;
  ctx.save();
  ctx.fillStyle = chartTheme().select;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(Math.min(x0, x1), u.bbox.top, Math.abs(x1 - x0), u.bbox.height);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = chartTheme().compareA;
  ctx.setLineDash([2, 4]);
  ctx.lineWidth = 1;
  for (const x of [x0, x1]) {
    const px = Math.round(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, u.bbox.top);
    ctx.lineTo(px, u.bbox.top + u.bbox.height);
    ctx.stroke();
  }
  ctx.restore();
}

/** Both transports, on a time-axis chart: A solid, B dashed in its series colour. */
function drawPlayheads(u: Uplot, a: LiveSideDto, b: LiveSideDto) {
  drawRule(u, a.playhead, chartTheme().playhead, [], "A");
  drawRule(u, b.playhead, chartTheme().compareB, [5, 4], "B");
}

/** B's dashed read-only cursor, on the axis its chart has. */
function drawPeerCursor(u: Uplot, live: LiveSideDto, axis: "time" | "freq" | "rate") {
  const value =
    axis === "time" ? live.cursorTime : axis === "freq" ? live.cursorFreq : live.cursorMod;
  drawRule(u, value, chartTheme().mirror, [4, 4], "B");
}

function drawRule(
  u: Uplot,
  value: number | null | undefined,
  color: string,
  dash: number[],
  label: string,
) {
  if (value == null || !Number.isFinite(value)) return;
  const x = u.valToPos(value, "x", true);
  if (!Number.isFinite(x)) return;
  const { ctx } = u;
  const px = Math.round(x) + 0.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(px, u.bbox.top);
  ctx.lineTo(px, u.bbox.top + u.bbox.height);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = chartTheme().font;
  ctx.fillText(label, px + 3, u.bbox.top + 11);
  ctx.restore();
}
