import { Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { clampScrollTop } from "../lib/scroll";

/**
 * Imperative handle for a [`ScrollArea`], handed to `apiRef`.
 *
 * Everything is clamped to the scrollable range, so a caller cannot scroll past either
 * end — including after the content shrinks under it.
 */
export type ScrollAreaApi = {
  /** Scroll to the top of the content. */
  scrollToTop(): void;
  /** Scroll to `top` px (clamped). */
  scrollTo(top: number): void;
  /** Scroll the smallest amount that reveals `el` entirely. */
  ensureVisible(el: HTMLElement): void;
};

/** Vertical inset (px) of the thumb's track inside the bar; mirrors `layout.css`. */
const BAR_INSET = 2;

const MIN_THUMB = 32;

/**
 * A scroll container with a **custom scrollbar**.
 *
 * macOS WKWebView shows an overlay scrollbar that ignores `::-webkit-scrollbar`
 * and `scrollbar-width`, so the native bar cannot be hidden with CSS there. We
 * therefore scroll **ourselves**: the viewport is `overflow: hidden` (no native
 * bar) and the content is translated by `scrollTop`. Wheel / trackpad / keyboard
 * scrolling is translated into the same signal, and the draggable thumb drives it
 * too — consistent on every platform.
 *
 * The bar is a **flex sibling** of the viewport (`layout.css`), never an overlay, so
 * it can never cover the content. `resetKey` scrolls back to the top whenever it
 * changes (a search query), and `apiRef` exposes the scroll actions to the owner.
 */
export default function ScrollArea(props: {
  class?: string;
  /** Scroll to the top whenever this value changes (e.g. a filtered list's query). */
  resetKey?: unknown;
  apiRef?: (api: ScrollAreaApi) => void;
  children: JSX.Element;
}) {
  let viewport!: HTMLDivElement;
  let content!: HTMLDivElement;
  let bar!: HTMLDivElement;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [thumb, setThumb] = createSignal({ height: 0, top: 0 });
  const [overflowing, setOverflowing] = createSignal(false);
  const [active, setActive] = createSignal(false);

  const scrollable = () => Math.max(0, content?.scrollHeight - viewport?.clientHeight);

  /** The thumb's track height: the bar's box minus its vertical inset. */
  const trackHeight = () => Math.max(0, bar.clientHeight - BAR_INSET * 2);

  function thumbFor(top: number) {
    const view = viewport.clientHeight;
    const contentHeight = content.scrollHeight;
    const track = trackHeight();
    const height =
      contentHeight > 0
        ? Math.max(MIN_THUMB, Math.min(track, (view / contentHeight) * track))
        : track;
    const maxTop = track - height;
    const space = contentHeight - view;
    const offset = space > 0 ? (Math.min(top, space) / space) * maxTop : 0;
    return { height, top: offset };
  }

  /** Move the content to `top`, clamped, and re-place the thumb. */
  function applyScroll(top: number) {
    setScrollTop(clampScrollTop(top, content.scrollHeight, viewport.clientHeight));
    setThumb(thumbFor(scrollTop()));
  }

  function update() {
    if (!viewport || !content) return;
    const max = scrollable();
    // The content shrank (a filtered list): never stay scrolled past the new end.
    if (scrollTop() > max) setScrollTop(max);
    if (max <= 1 || trackHeight() <= 0) {
      setOverflowing(false);
      return;
    }
    setOverflowing(true);
    setThumb(thumbFor(scrollTop()));
  }

  function scrollBy(delta: number) {
    applyScroll(scrollTop() + delta);
  }

  function ensureVisible(el: HTMLElement) {
    if (!viewport || !content) return;
    // The content is translated, so measure the element against the content's own box
    // (both rects carry the same transform, which cancels out).
    const top = el.getBoundingClientRect().top - content.getBoundingClientRect().top;
    const view = viewport.clientHeight;
    const current = scrollTop();
    if (top < current) applyScroll(top);
    else if (top + el.offsetHeight > current + view) applyScroll(top + el.offsetHeight - view);
  }

  const api: ScrollAreaApi = {
    scrollToTop: () => applyScroll(0),
    scrollTo: applyScroll,
    ensureVisible,
  };

  /** Reset to the top when the owner's key changes (not on the initial mount). */
  createEffect(
    on(
      () => props.resetKey,
      () => applyScroll(0),
      { defer: true },
    ),
  );

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
    const track = trackHeight();
    const m = thumbFor(scrollTop());
    if (track - m.height <= 0) return;
    const ratio = scrollable() / (track - m.height);
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
    props.apiRef?.(api);
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
