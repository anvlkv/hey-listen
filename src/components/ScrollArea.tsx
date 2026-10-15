import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";

/**
 * A scroll container with a **custom scrollbar**.
 *
 * macOS WKWebView shows an overlay scrollbar that ignores `::-webkit-scrollbar`
 * and `scrollbar-width`, so the native bar cannot be hidden with CSS there. We
 * therefore scroll **ourselves**: the viewport is `overflow: hidden` (no native
 * bar) and the content is translated by `scrollTop`. Wheel / trackpad / keyboard
 * scrolling is translated into the same signal, and the draggable thumb drives it
 * too — consistent on every platform.
 */
export default function ScrollArea(props: { class?: string; children: JSX.Element }) {
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  let bar!: HTMLDivElement;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [thumb, setThumb] = createSignal({ height: 0, top: 0 });
  const [overflowing, setOverflowing] = createSignal(false);
  const [active, setActive] = createSignal(false);

  const MIN_THUMB = 32;

  const scrollable = () => Math.max(0, content?.scrollHeight - viewport?.clientHeight);

  function metrics() {
    const view = viewport.clientHeight;
    const contentHeight = content.scrollHeight;
    const track = bar.clientHeight;
    const height = Math.max(MIN_THUMB, Math.min(track, (view / contentHeight) * track));
    const maxTop = track - height;
    const space = contentHeight - view;
    const top = space > 0 ? (Math.min(scrollTop(), space) / space) * maxTop : 0;
    return { height, top };
  }

  function update() {
    if (scrollable() <= 1 || bar.clientHeight <= 0) {
      setOverflowing(false);
      return;
    }
    setOverflowing(true);
    const m = metrics();
    setThumb({ height: m.height, top: m.top });
  }

  function scrollBy(delta: number) {
    const next = Math.max(0, Math.min(scrollable(), scrollTop() + delta));
    setScrollTop(next);
    const m = metrics();
    setThumb({ height: m.height, top: m.top });
  }

  function onWheel(event: WheelEvent) {
    // Delta can be 0 for horizontal trackpads; ignore those.
    if (event.deltaY !== 0) {
      event.preventDefault();
      scrollBy(event.deltaY);
    }
  }

  let drag: { y: number; start: number } | null = null;

  function onThumbDown(event: PointerEvent) {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag = { y: event.clientY, start: scrollTop() };
    setActive(true);
  }

  function onThumbMove(event: PointerEvent) {
    if (!drag) return;
    const m = metrics();
    if (m.top < 0 || bar.clientHeight - m.height <= 0) return;
    const ratio = scrollable() / (bar.clientHeight - m.height);
    scrollBy((event.clientY - drag.y) * ratio - (scrollTop() - drag.start));
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
    observer.observe(content);
    // The content grows/shrinks without resizing the viewport (list changes).
    const mutation = new MutationObserver(() => update());
    mutation.observe(content, { childList: true, subtree: true });
    update();
    onCleanup(() => {
      observer.disconnect();
      mutation.disconnect();
    });
  });

  return (
    <div class={`scroll-area ${props.class ?? ""}`}>
      <div class="scroll-area-viewport" ref={(node) => (viewport = node)} onWheel={onWheel}>
        <div
          class="scroll-area-content"
          ref={(node) => (content = node)}
          style={{ transform: `translateY(${-scrollTop()}px)` }}
        >
          {props.children}
        </div>
      </div>
      <div
        class="scroll-area-bar"
        classList={{ "scroll-area-bar-hidden": !overflowing() }}
        ref={(node) => (bar = node)}
      >
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
