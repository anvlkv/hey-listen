import { createSignal, Show, type JSX } from "solid-js";
import { clampViewStart, thumbPercent } from "../../lib/timelineScroll";

/**
 * The Timeline's horizontal scrollbar: an overview strip along the bottom of the region
 * whose thumb *is* the visible view, so a zoomed-in timeline can be panned without
 * dragging the waveform (which is the Timeline's own pan gesture) and without guessing
 * where the view sits inside the file.
 *
 * The thumb only renders while the view is narrower than the source — zoomed out there is
 * nothing to scroll, and the track keeps its (fixed) height either way, so a zoom never
 * reflows the canvas. Drag the thumb to pan, click the track to jump, or focus it and use
 * the arrow keys. See `docs/ui-layout.md` → Timeline.
 */
export default function ScrollBar(props: {
  /** The visible span, in source seconds. */
  view: () => [number, number];
  /** The whole source, in seconds (`0` when there is none). */
  duration: () => number;
  /** Pan the view to `start` (the caller clamps and keeps the visible span). */
  onScroll: (start: number) => void;
}): JSX.Element {
  let track: HTMLDivElement | undefined;
  const [dragging, setDragging] = createSignal(false);
  /** The pointer's offset inside the thumb when a drag began, in px. */
  let grab = 0;

  const span = () => Math.max(props.view()[1] - props.view()[0], 0);
  const zoomed = () => props.duration() > 0 && span() < props.duration() - 1e-9;

  /** The view start that puts the grab point under `clientX`. */
  function startFromPointer(clientX: number): number {
    const rect = track?.getBoundingClientRect();
    if (!rect || !(rect.width > 0)) return 0;
    const raw = ((clientX - rect.left - grab) / rect.width) * props.duration();
    return clampViewStart(raw, props.duration(), span());
  }

  /** The thumb's rendered width, in px (its ideal width, so a click can centre it). */
  function idealThumbWidth(): number {
    const width = track?.getBoundingClientRect().width ?? 0;
    return (width * span()) / Math.max(props.duration(), 1e-9);
  }

  const onPointerDown = (event: PointerEvent) => {
    const el = track;
    if (!el || event.button !== 0) return;
    event.preventDefault();
    const thumb = el.firstElementChild;
    const onThumb = !!thumb && thumb.contains(event.target as Node);
    // Grabbing the thumb keeps it under the pointer; a click on the track centres it.
    grab = onThumb ? event.clientX - thumb!.getBoundingClientRect().left : idealThumbWidth() / 2;
    el.setPointerCapture(event.pointerId);
    setDragging(true);
    props.onScroll(startFromPointer(event.clientX));
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dragging()) props.onScroll(startFromPointer(event.clientX));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging()) return;
    setDragging(false);
    if (track?.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Pan by a tenth of the visible span, clamped by the caller.
    const step = span() * 0.1;
    if (event.key === "ArrowLeft") props.onScroll(props.view()[0] - step);
    else if (event.key === "ArrowRight") props.onScroll(props.view()[0] + step);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={(el) => {
        track = el;
      }}
      class="timeline-scroll"
      classList={{ "timeline-scroll-active": dragging() }}
      data-testid="timeline.scroll"
      role="scrollbar"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label="Scroll the timeline"
      aria-valuemin={0}
      aria-valuemax={props.duration()}
      aria-valuenow={props.view()[0]}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <Show when={zoomed()}>
        <div
          class="timeline-scroll-thumb"
          data-testid="timeline.scroll.thumb"
          style={thumbPercent(props.view()[0], props.view()[1], props.duration())}
        />
      </Show>
    </div>
  );
}
