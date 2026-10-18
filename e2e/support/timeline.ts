/**
 * Timeline E2E helpers (M8).
 *
 * The analysis-window handles (start / end), the whole-window move bar and the note
 * lane are drawn on the Timeline **canvas**, not the DOM, so they are addressed by
 * their known canvas position rather than a selector — which is why every suite that
 * moves the window shares this helper instead of copying the geometry. See
 * `docs/testing.md`.
 */
import { SEL } from "./selectors.ts";

/** `PLOT_PAD` inside the plotted region — mirrors `src/components/Timeline.tsx`. */
const PLOT_PAD = 12;
/** `RULER_H` and the move handle's hit band — mirrors `timeline/constants.ts`. */
const RULER_H = 22;
const MOVE_HIT = 10;
/** Clear of `HANDLE_HIT` (9 px) when grabbing the window's move bar. */
const MOVE_GRAB_INSET = 24;

/** What to grab on the Timeline canvas: an edge handle or the window's move bar. */
type TimelineGrab = "start" | "end" | "move";

/**
 * Drag one Timeline target by `dx` pixels, delivering the movement as `moves` pointer
 * moves inside **one** gesture. A handle is anchored at the plot's padded edge; the
 * move bar just inside the window's start edge, so the window must start at the plot's
 * left edge (pull the end in first to leave room). W3C pointer actions don't reliably
 * reach the system WebView, so the Pointer Events are dispatched directly — the app's
 * real handlers still run. It then waits for the window change to settle, because the
 * readout is asserted straight after in several suites.
 */
async function dragTimeline(grab: TimelineGrab, dx: number, moves: number): Promise<void> {
  await browser.execute(
    (
      sel: string,
      target: string,
      offset: number,
      steps: number,
      pad: number,
      ruler: number,
      hit: number,
      inset: number,
    ) => {
      const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
      if (!canvas) throw new Error("dragTimeline: no timeline canvas");
      const rect = canvas.getBoundingClientRect();
      const x =
        target === "start"
          ? rect.left + pad
          : target === "end"
            ? rect.right - pad
            : rect.left + pad + inset;
      const y = target === "move" ? rect.top + ruler + hit / 2 : rect.top + rect.height / 2;
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
      for (let i = 1; i <= steps; i++) fire("pointermove", x + (offset * i) / steps, 1);
      fire("pointerup", x + offset, 0);
    },
    SEL.timelineCanvas,
    grab,
    dx,
    moves,
    PLOT_PAD,
    RULER_H,
    MOVE_HIT,
    // `HANDLE_HIT` is 9 px, so grabbing 24 px in clears both edge handles.
    MOVE_GRAB_INSET,
  );
  await browser.pause(250);
}

/** Drag one of the Timeline's analysis-window handles (`start` / `end`) by `dx` px. */
export async function dragTimelineHandle(
  which: "start" | "end",
  dx: number,
  moves = 1,
): Promise<void> {
  await dragTimeline(which, dx, moves);
}

/** Drag the whole analysis window by its top move bar (keeping its width). */
export async function dragTimelineWindow(dx: number, moves = 1): Promise<void> {
  await dragTimeline("move", dx, moves);
}
