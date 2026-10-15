import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import type { AnalyzerBus, SyncGroup } from "../../state/chartSync";
import { chartTheme } from "../../state/themes";

/** The uPlot instance type, taken from the wrapper's plugin props. */
type UplotInstance = TooltipProps["u"];

/**
 * Cross-tab sync plugins (M5).
 *
 * Both read the shared [`analyzerBus`](../../state/chartSync.ts), publishing/
 * consuming the `cursorSync` and `view` keys. Both are **group-aware**: a time
 * chart and a frequency chart never mirror each other. A plugin no-ops without a
 * bus.
 */

/** Mirror the cursor of whichever chart in the same group is hovered. */
export const mirrorCursor =
  (group: SyncGroup): UplotPluginFactory<AnalyzerBus> =>
  ({ bus }) => {
    if (!bus) return { hooks: {} };
    let dispose: (() => void) | undefined;
    let pointerLeave: (() => void) | undefined;
    return {
      hooks: {
        ready: (u) => {
          pointerLeave = () => bus.setData("cursorSync", { sourceId: u.root.id, group, x: null });
          u.over.addEventListener("pointerleave", pointerLeave);
          // Redraw when the shared cursor of this group changes.
          dispose = createRoot((root) => {
            createEffect(() => {
              const msg = bus.data.cursorSync;
              if (msg && msg.group === group && msg.sourceId !== u.root.id) u.redraw(false);
            });
            return root;
          });
        },
        setCursor: (u) => {
          const idx = u.cursor.idx;
          const xs = u.data[0];
          const x = idx != null && xs && idx < xs.length ? Number(xs[idx]) : null;
          bus.setData("cursorSync", { sourceId: u.root.id, group, x });
        },
        draw: (u) => {
          const msg = bus.data.cursorSync;
          if (!msg || msg.group !== group || msg.sourceId === u.root.id || msg.x == null) return;
          const x = u.valToPos(msg.x, "x", true);
          if (!Number.isFinite(x) || !u.ctx) return;
          const px = Math.round(x) + 0.5;
          const { ctx } = u;
          ctx.save();
          ctx.strokeStyle = chartTheme().mirror;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(px, u.bbox.top);
          ctx.lineTo(px, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        },
        destroy: (u) => {
          u.over.removeEventListener("pointerleave", pointerLeave!);
          dispose?.();
        },
      },
    };
  };

/**
 * Draw the **preview playhead** as a solid rule (M14 follow-up): the source second the
 * core is auditioning, so the charts show "playing now" and not just the Timeline.
 *
 * The position rides the shared bus (`playhead`), published by the Timeline's preview
 * controller. Unlike [`mirrorCursor`] — a dashed rule following *another chart's* hover
 * — this is the transport's own position, so it is drawn solid, in the playhead colour.
 */
export const playheadRule =
  (): UplotPluginFactory<AnalyzerBus> =>
  ({ bus }) => {
    if (!bus) return { hooks: {} };
    let dispose: (() => void) | undefined;
    return {
      hooks: {
        ready: (u) => {
          // Track the message: repaint as the transport advances, and once more when it
          // stops (published as `secs: null`) so the rule is erased. Before anything has
          // ever played there is nothing to paint.
          dispose = createRoot((root) => {
            createEffect(() => {
              if (bus.data.playhead != null) u.redraw(false);
            });
            return root;
          });
        },
        draw: (u) => {
          const secs = bus.data.playhead?.secs;
          if (secs == null || !u.ctx) return;
          const x = u.valToPos(secs, "x", true);
          if (!Number.isFinite(x)) return;
          const { ctx } = u;
          const px = Math.round(x) + 0.5;
          ctx.save();
          ctx.strokeStyle = chartTheme().playhead;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px, u.bbox.top);
          ctx.lineTo(px, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        },
        destroy: () => dispose?.(),
      },
    };
  };

/** Mirror the x-range of charts in the same [`SyncGroup`]. */
export const syncView =
  (group: SyncGroup): UplotPluginFactory<AnalyzerBus> =>
  ({ bus }) => {
    if (!bus) return { hooks: {} };
    let dispose: (() => void) | undefined;
    let destroyed = false;

    /** Apply a shared x-range, clamped to this chart's own data extent. */
    const applyShared = (u: UplotInstance, x: [number, number]) => {
      const scale = u.scales.x;
      if (typeof scale.min !== "number" || typeof scale.max !== "number") return;
      const xs = u.data[0];
      if (!xs || xs.length < 2) return;
      const min = Math.max(Math.min(x[0], x[1]), xs[0]);
      const max = Math.min(Math.max(x[0], x[1]), xs[xs.length - 1]);
      if (!(max > min)) return;
      if (Math.abs(scale.min - min) < 1e-9 && Math.abs(scale.max - max) < 1e-9) return;
      u.setScale("x", { min, max });
    };

    return {
      hooks: {
        ready: (u) => {
          dispose = createRoot((root) => {
            createEffect(() => {
              const view = bus.data.view;
              if (!view || view.group !== group) return;
              applyShared(u, view.x);
            });
            return root;
          });
        },
        // uPlot resets the x-scale to fit on every `setData` (i.e. on every analysis
        // result), which would discard the zoom. Re-apply the shared range — the
        // last range a user action published — once the reset has settled, so a zoom
        // survives an FFT / window / channel change.
        setData: (u) => {
          queueMicrotask(() => {
            if (destroyed) return;
            const view = bus.data.view;
            if (!view || view.group !== group) return;
            applyShared(u, view.x);
          });
        },
        destroy: () => {
          destroyed = true;
          dispose?.();
        },
      },
    };
  };
