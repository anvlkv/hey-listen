import { createSignal, type Accessor } from "solid-js";
import type { TooltipProps } from "@dschz/solid-uplot/plugins";
import {
  IDENTITY_AXIS,
  publishChartView,
  type AxisTransform,
  type SyncGroup,
} from "../../state/chartSync";

/** The uPlot instance type, taken from the wrapper's plugin props (avoids a CJS default import). */
type UplotInstance = TooltipProps["u"];

/**
 * Zoom/pan controller for a 1-D solid-uplot chart (waveform, spectrum, series).
 *
 * uPlot has no built-in wheel zoom, so we add it (around the pointer) here, plus
 * explicit zoom in/out and fit. Drag-select zoom stays uPlot's own. The visible
 * x-range is tracked so the controls can show it.
 *
 * Every action that moves the x-scale publishes the new range on the shared
 * [`analyzerBus`](../../state/chartSync.ts) under its [`SyncGroup`], so the other
 * charts in the group follow. Publishing lives here (not in the `syncView` plugin's
 * `setScale` hook) so the shared view always reflects an explicit user action and
 * never an implicit fit — see `syncPlugins.ts` for the restore-on-data-update side.
 */
export interface UplotZoom {
  /** Attach to `SolidUplot`'s `onCreate`. */
  onReady: (u: UplotInstance) => void;
  /** Attach to the plot wrapper's `onWheel`. */
  wheel: (event: WheelEvent) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Reset the x-axis to the full data extent. */
  fit: () => void;
  /** The visible x-range, kept in sync with every scale change. */
  range: () => [number, number] | null;
  /**
   * True while the visible range still matches the data's full extent — the shared
   * chart wrapper uses it to keep the zoom controls revealed only while they are needed.
   */
  fitted: Accessor<boolean>;
  /** The live uPlot instance, or `null` before `onReady` — e.g. for `posToVal`. */
  instance: () => UplotInstance | null;
}

export function createUplotZoom(
  group: SyncGroup,
  transform: AxisTransform = IDENTITY_AXIS,
): UplotZoom {
  const [instance, setInstance] = createSignal<UplotInstance | null>(null);
  const [range, setRange] = createSignal<[number, number] | null>(null);

  const sync = (u: UplotInstance) => {
    const scale = u.scales.x;
    if (typeof scale.min === "number" && typeof scale.max === "number") {
      setRange([scale.min, scale.max]);
    }
  };

  /** The data's x extent (first → last point), or `null` when there is no data. */
  const dataExtent = (): [number, number] | null => {
    const xs = instance()?.data[0];
    if (!xs || xs.length < 2) return null;
    return [xs[0], xs[xs.length - 1]];
  };

  /** Mirror the visible range to the other charts in this group. */
  const publish = (min: number, max: number) => {
    const u = instance();
    if (!u) return;
    publishChartView({
      sourceId: u.root.id,
      group,
      x: [transform.toBus(min), transform.toBus(max)],
    });
  };

  const apply = (min: number, max: number) => {
    const u = instance();
    if (!u || !(max > min)) return;
    // Never zoom out beyond the data: clamp the view to the x extent.
    const extent = dataExtent();
    if (extent) {
      min = Math.max(min, extent[0]);
      max = Math.min(max, extent[1]);
      if (!(max > min)) return;
    }
    u.setScale("x", { min, max });
    publish(min, max);
  };

  const scaleX = (): [number, number] | null => {
    const scale = instance()?.scales.x;
    if (typeof scale?.min === "number" && typeof scale.max === "number") {
      return [scale.min, scale.max];
    }
    return null;
  };

  /** Whether the visible x-range is still the data's full extent (a small epsilon). */
  const fitted = (): boolean => {
    const current = range();
    const extent = dataExtent();
    if (!current || !extent) return true;
    const span = Math.max(extent[1] - extent[0], 1e-9);
    return (
      Math.abs(current[0] - extent[0]) / span < 2e-3 &&
      Math.abs(current[1] - extent[1]) / span < 2e-3
    );
  };

  const factor = (f: number) => {
    const current = scaleX();
    if (!current) return;
    const [min, max] = current;
    const center = (min + max) / 2;
    const half = ((max - min) / 2) * f;
    apply(center - half, center + half);
  };

  return {
    onReady(u) {
      setInstance(u);
      const onSetScale = (self: UplotInstance, key: string) => {
        if (key === "x") sync(self);
      };
      if (u.hooks.setScale) u.hooks.setScale.push(onSetScale);
      else u.hooks.setScale = [onSetScale];
      sync(u);
    },
    wheel(event) {
      const u = instance();
      const current = scaleX();
      if (!u || !u.over || !current) return;
      event.preventDefault();
      const rect = u.over.getBoundingClientRect();
      const at = u.posToVal(event.clientX - rect.left, "x");
      const f = event.deltaY < 0 ? 0.8 : 1.25;
      apply(at + (current[0] - at) * f, at + (current[1] - at) * f);
    },
    zoomIn: () => factor(0.5),
    zoomOut: () => factor(2),
    fit() {
      const u = instance();
      const xs = u?.data[0];
      if (!u || !xs || xs.length < 2) return;
      apply(xs[0], xs[xs.length - 1]);
    },
    range,
    fitted,
    instance,
  };
}
