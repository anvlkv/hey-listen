import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";

/**
 * A scroll container with a **custom scrollbar**.
 *
 * macOS WKWebView (like Chromium on macOS) uses overlay scrollbars and ignores
 * `::-webkit-scrollbar`, so the scrollbar cannot be themed with CSS there. This
 * hides the native bar and draws a themed one instead — consistent on every
 * platform. Native scrolling (wheel, trackpad, keyboard) is untouched; the thumb
 * is draggable.
 */
export default function ScrollArea(props: { class?: string; children: JSX.Element }) {
  let viewport!: HTMLDivElement;
  let bar!: HTMLDivElement;
  const [thumb, setThumb] = createSignal({ height: 0, top: 0 });
  const [overflowing, setOverflowing] = createSignal(false);
  const [active, setActive] = createSignal(false);

  const MIN_THUMB = 32;

  /** Thumb geometry for the current scroll position. */
  function metrics() {
    const view = viewport.clientHeight;
    const content = viewport.scrollHeight;
    const track = bar.clientHeight;
    const height = Math.max(MIN_THUMB, Math.min(track, (view / content) * track));
    const maxTop = track - height;
    const scrollable = content - view;
    const top = scrollable > 0 ? (viewport.scrollTop / scrollable) * maxTop : 0;
    return { view, content, track, height, maxTop, scrollable, top };
  }

  function update() {
    if (viewport.scrollHeight <= viewport.clientHeight + 1 || bar.clientHeight <= 0) {
      setOverflowing(false);
      return;
    }
    setOverflowing(true);
    const m = metrics();
    setThumb({ height: m.height, top: m.top });
  }

  let drag: { y: number; start: number } | null = null;

  function onThumbDown(event: PointerEvent) {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { y: event.clientY, start: viewport.scrollTop };
    setActive(true);
  }

  function onThumbMove(event: PointerEvent) {
    if (!drag) return;
    const m = metrics();
    if (m.maxTop <= 0) return;
    const ratio = m.scrollable / m.maxTop;
    viewport.scrollTop = drag.start + (event.clientY - drag.y) * ratio;
  }

  function onThumbUp(event: PointerEvent) {
    drag = null;
    setActive(false);
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  onMount(() => {
    const observer = new ResizeObserver(() => update());
    observer.observe(viewport);
    // The content grows/shrinks without resizing the viewport (list changes).
    const mutation = new MutationObserver(() => update());
    mutation.observe(viewport, { childList: true, subtree: true });
    update();
    onCleanup(() => {
      observer.disconnect();
      mutation.disconnect();
    });
  });

  return (
    <div class={`scroll-area ${props.class ?? ""}`}>
      <div class="scroll-area-viewport" ref={viewport} onScroll={update}>
        {props.children}
      </div>
      <div class="scroll-area-bar" classList={{ "scroll-area-bar-hidden": !overflowing() }} ref={bar}>
        <Show when={overflowing()}>
          <div
            class="scroll-area-thumb"
            classList={{ "scroll-area-thumb-active": active() }}
            style={{ height: `${thumb().height}px`, transform: `translateY(${thumb().top}px)` }}
            onPointerDown={onThumbDown}
            onPointerMove={onThumbMove}
            onPointerUp={onThumbUp}
            onPointerCancel={onThumbUp}
          />
        </Show>
      </div>
    </div>
  );
}
