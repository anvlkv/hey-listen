import { onCleanup } from "solid-js";
import { createWheelGesture } from "../../lib/wheelGesture";
import { stopFollowing } from "../../state/capture";
import { source } from "../../state/source";
import { viewEnd, viewStart, windowEnd, windowStart } from "../../state/timeline";

/**
 * The Timeline's **view** zoom/pan (M23): the wheel gesture plus the toolbar's zoom
 * actions. Split out of `interaction.ts` so the pointer state machine and the view
 * transform stay separate files.
 *
 * A vertical wheel zooms around the pointer and a horizontal wheel or `Shift` + vertical
 * pans the time axis; there is no vertical waveform zoom. See `lib/wheelGesture.ts` and
 * `docs/roadmap.md` → M23 → "Wheel and trackpad stability".
 */

export interface TimelineZoomDeps {
  canvas: () => HTMLCanvasElement;
  duration: () => number;
  x2t: (x: number) => number;
  span: () => number;
  plotW: () => number;
  applyView: (a: number, b: number) => void;
}

export interface TimelineZoom {
  onWheel: (e: WheelEvent) => void;
  zoomBy: (factor: number) => void;
  zoomToWindow: () => void;
  fitAll: () => void;
}

export function createTimelineZoom(deps: TimelineZoomDeps): TimelineZoom {
  const wheel = createWheelGesture({
    enabled: () => source() != null,
    apply: (gesture) => {
      stopFollowing();
      if (gesture.kind === "zoom") {
        const t = deps.x2t(gesture.clientX - deps.canvas().getBoundingClientRect().left);
        deps.applyView(
          t + (viewStart() - t) * gesture.factor,
          t + (viewEnd() - t) * gesture.factor,
        );
        return;
      }
      // Pan time from the dominant delta: scrolling right or down advances the view.
      const delta = Math.abs(gesture.dx) > Math.abs(gesture.dy) ? gesture.dx : gesture.dy;
      const dt = (delta / deps.plotW()) * deps.span();
      deps.applyView(viewStart() + dt, viewEnd() + dt);
    },
  });
  onCleanup(wheel.dispose);

  return {
    onWheel: wheel.wheel,
    zoomBy(factor) {
      stopFollowing();
      const center = (viewStart() + viewEnd()) / 2;
      deps.applyView(
        center + (viewStart() - center) * factor,
        center + (viewEnd() - center) * factor,
      );
    },
    zoomToWindow() {
      stopFollowing();
      const wDur = windowEnd() - windowStart();
      const pad = Math.max(wDur * 0.05, 1e-3);
      deps.applyView(
        Math.max(0, windowStart() - pad),
        Math.min(deps.duration(), windowEnd() + pad),
      );
    },
    fitAll() {
      stopFollowing();
      deps.applyView(0, deps.duration());
    },
  };
}
