import { ContextMenu } from "@kobalte/core/context-menu";
import type { MenuRootOptions } from "@kobalte/core/menu";
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { useAnchorLifetime } from "../../lib/anchorLifetime";
import { createPopupMount } from "../../lib/popupMount";
import { createAnnotation } from "../../state/annotations";
import { source } from "../../state/source";
import { reframeWindow, windowEnd, windowStart } from "../../state/timeline";
import { minWindowFor } from "./selection";
import { setSnapEnabled, snapEnabled } from "./snapping";

/**
 * The Timeline canvas's **context menu** (D-11): set the analysis window from the pointer's
 * time, add a Timeline annotation there, restore the whole-source window, zoom, or toggle
 * snapping.
 *
 * Kobalte's `ContextMenu` is the primitive. Its `Trigger` **is** the caller's
 * `.timeline-canvas` wrapper — same class, same ref — so the layout, the CSS and the node
 * `syncCanvasSize` measures are unchanged. The content portals through `createPopupMount`, so
 * a popped-out window mounts it in that document, and it closes with the canvas (see
 * `lib/anchorLifetime.ts`). The pointer time is recorded by our own capture-phase
 * `contextmenu` listener, which runs before Kobalte opens the menu on the same event. See
 * `docs/deferred.md` → D-11 and `docs/annotations.md`.
 */
export default function TimelineContextMenu(props: {
  ref?: (el: HTMLDivElement) => void;
  /** Source seconds under a client x (already clamped to the source). */
  timeAt: (clientX: number) => number;
  onZoomWindow: () => void;
  onFit: () => void;
  children: JSX.Element;
}) {
  const portal = createPopupMount();
  /** The time under the right-click; each item reads it live, so no closure can go stale. */
  const [time, setTime] = createSignal(0);
  /** The menu's open state, mirrored from Kobalte — the only way to shut it from here. */
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLDivElement | undefined;

  const minWindow = () => minWindowFor(source()?.sampleRate);

  useAnchorLifetime({ anchor: portal.anchor, open, onClose: () => setOpen(false) });

  // `ContextMenu.Root` types `open` out — it drives its inner `MenuRoot` from its own
  // disclosure state — but it passes every other prop through to that `MenuRoot`, which
  // spreads them *after* its `open`, so this getter is a working controlled value. It has
  // to be controlled: the menu's close paths (Escape, an outside pointerdown, an item
  // select) all live in the portaled content, which is exactly what a lost canvas leaves
  // stranded, so nothing else could shut it.
  const openProps: Partial<MenuRootOptions> = {
    get open() {
      return open();
    },
  };

  const attach = (node: HTMLDivElement) => {
    trigger = node;
    portal.ref(node);
    props.ref?.(node);
  };

  onMount(() => {
    const node = trigger;
    if (!node) return;
    // Capture phase: record the target time and resolve the mount document before Kobalte
    // opens the menu for the same event.
    const track = (event: MouseEvent) => {
      setTime(props.timeAt(event.clientX));
      portal.refresh();
    };
    node.addEventListener("contextmenu", track, true);
    onCleanup(() => node.removeEventListener("contextmenu", track, true));
  });

  return (
    <ContextMenu
      {...openProps}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) portal.refresh();
      }}
    >
      <ContextMenu.Trigger as="div" class="timeline-canvas" ref={attach}>
        {props.children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal mount={portal.mount()}>
        <ContextMenu.Content class="pop-panel timeline-menu" data-testid="timeline.menu">
          <ContextMenu.Item
            class="timeline-menu-item"
            data-testid="timeline.menu.start"
            disabled={!source()}
            onSelect={() => {
              const t = time();
              reframeWindow({ start: t, end: Math.max(t + minWindow(), windowEnd()) });
            }}
          >
            Set window start here
          </ContextMenu.Item>
          <ContextMenu.Item
            class="timeline-menu-item"
            data-testid="timeline.menu.end"
            disabled={!source()}
            onSelect={() => {
              const t = time();
              reframeWindow({
                start: Math.min(windowStart(), Math.max(0, t - minWindow())),
                end: t,
              });
            }}
          >
            Set window end here
          </ContextMenu.Item>
          <ContextMenu.Item
            class="timeline-menu-item"
            data-testid="timeline.menu.annotation"
            disabled={!source()}
            onSelect={() => createAnnotation({ timeSecs: time(), tool: null })}
          >
            Add an annotation here
          </ContextMenu.Item>
          <ContextMenu.Separator class="timeline-menu-sep" />
          <ContextMenu.Item
            class="timeline-menu-item"
            data-testid="timeline.menu.whole"
            onSelect={() => reframeWindow({ start: 0, end: source()?.duration ?? 0, frame: true })}
          >
            Window: whole source
          </ContextMenu.Item>
          <ContextMenu.Item
            class="timeline-menu-item"
            data-testid="timeline.menu.zoom"
            onSelect={props.onZoomWindow}
          >
            Zoom to window
          </ContextMenu.Item>
          <ContextMenu.Item
            class="timeline-menu-item"
            data-testid="timeline.menu.fit"
            onSelect={props.onFit}
          >
            Fit all
          </ContextMenu.Item>
          <ContextMenu.Separator class="timeline-menu-sep" />
          <ContextMenu.CheckboxItem
            class="timeline-menu-item timeline-menu-checkbox"
            data-testid="timeline.menu.snap"
            checked={snapEnabled()}
            onChange={(checked) => setSnapEnabled(checked)}
          >
            Snap to grid and markers
          </ContextMenu.CheckboxItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}
