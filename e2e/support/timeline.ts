/**
 * Timeline E2E helpers (M8).
 *
 * The analysis-window handles (start / end) and the note lane are drawn on the
 * Timeline **canvas**, not the DOM, so they are addressed by their known canvas
 * position rather than a selector — which is why every suite that moves the window
 * shares this helper instead of copying the geometry. See `docs/testing.md`.
 */
import { SEL } from "./selectors.ts";

/** `PLOT_PAD` inside the plotted region — mirrors `src/components/Timeline.tsx`. */
const PLOT_PAD = 12;

/**
 * Drag one of the Timeline's analysis-window handles (`start` / `end`) by `dx` pixels.
 * W3C pointer actions don't reliably reach the system WebView, so the Pointer Events are
 * dispatched directly — the app's real handlers still run. It then waits for the window
 * change to settle, because the readout is asserted straight after in several suites.
 */
export async function dragTimelineHandle(which: "start" | "end", dx: number): Promise<void> {
  await browser.execute(
    (sel: string, side: string, offset: number, pad: number) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!canvas) throw new Error("dragTimelineHandle: no timeline canvas");
      const rect = canvas.getBoundingClientRect();
      const x = side === "start" ? rect.left + pad : rect.right - pad;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, cx: number, buttons: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: cx,
            clientY: y,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            buttons,
          }),
        );
      fire("pointerdown", x, 1);
      fire("pointermove", x + offset, 1);
      fire("pointerup", x + offset, 0);
    },
    SEL.timelineCanvas,
    which,
    dx,
    PLOT_PAD,
  );
  await browser.pause(250);
}
