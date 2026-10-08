import { createEffect, createRoot } from "solid-js";
import type { UplotPluginFactory } from "@dschz/solid-uplot";
import type { AnalyzerBus, SyncGroup } from "../../state/chartSync";

/**
 * Cross-tab sync plugins (M5).
 *
 * Both read the shared [`analyzerBus`](../../state/chartSync.ts), publishing/
 * consuming the `cursorSync` and `view` keys. Both are **group-aware**: a time
 * chart and a frequency chart never mirror each other. A plugin no-ops without a
 * bus.
 */

/** Mirror the cursor of whichever chart in the same group is hovered. */
export const mirrorCursor = (group: SyncGroup): UplotPluginFactory<AnalyzerBus> => ({ bus }) => {
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
        ctx.strokeStyle = "rgba(120, 170, 255, 0.55)";
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

/** Mirror the x-range of charts in the same [`SyncGroup`]. */
export const syncView = (group: SyncGroup): UplotPluginFactory<AnalyzerBus> => ({ bus }) => {
  if (!bus) return { hooks: {} };
  let dispose: (() => void) | undefined;
  // Set while applying a remote range, so its own `setScale` does not republish.
  let applying = false;
  return {
    hooks: {
      ready: (u) => {
        dispose = createRoot((root) => {
          createEffect(() => {
            const view = bus.data.view;
            if (!view || view.group !== group || view.sourceId === u.root.id) return;
            const scale = u.scales.x;
            const same =
              typeof scale.min === "number" &&
              typeof scale.max === "number" &&
              Math.abs(scale.min - view.x[0]) < 1e-9 &&
              Math.abs(scale.max - view.x[1]) < 1e-9;
            if (same) return;
            applying = true;
            u.setScale("x", { min: view.x[0], max: view.x[1] });
            applying = false;
          });
          return root;
        });
      },
      setScale: (u, key) => {
        if (key !== "x" || applying) return;
        const scale = u.scales.x;
        const xs = u.data[0];
        if (!xs || xs.length < 2) return;
        if (typeof scale.min !== "number" || typeof scale.max !== "number") return;
        // Only propagate real zooms, not a fit-to-data from a freshly opened chart
        // (which would otherwise reset the peers' zoom when a tab is added).
        const full = Number(xs[xs.length - 1]) - Number(xs[0]);
        const span = scale.max - scale.min;
        if (!(full > 0) || span >= full * 0.999) return;
        bus.setData("view", { sourceId: u.root.id, group, x: [scale.min, scale.max] });
      },
      destroy: () => dispose?.(),
    },
  };
};
