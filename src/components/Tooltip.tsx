import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useAnchorLifetime } from "../lib/anchorLifetime";
import { createPopupMount } from "../lib/popupMount";

/**
 * Tooltip — a thin wrapper over Kobalte's accessible `Tooltip` (ADR-8): a small,
 * theme-styled label shown on hover/focus of a control. It replaces the native
 * `title` attribute for controls, so the hint matches the app's look and is not
 * limited by the OS tooltip.
 *
 * The trigger is a single-child **column flexbox**: it has a real box (Floating UI
 * anchors the tooltip to it — a `display: contents` wrapper has no box and puts the
 * tooltip at the top-left) yet stays layout-transparent, because the wrapped control
 * fills the anchor's width and keeps its own height. The popup is portaled into the
 * trigger's document (`mount`), so it works in a popped-out window too.
 *
 * The open state is ours rather than Kobalte's so the wrapper can force it shut when
 * the trigger disappears from the DOM — see [`useAnchorLifetime`](../lib/anchorLifetime.ts).
 *
 * ```tsx
 * <Tooltip label="Zoom in">
 *   <Button …><Icon name="expand" /></Button>
 * </Tooltip>
 * ```
 */
export default function Tooltip(props: {
  label: JSX.Element;
  /** A formatted binding chip shown after the label (e.g. `⌘K`). */
  shortcut?: string;
  placement?: "top" | "bottom" | "left" | "right";
  class?: string;
  /** Extra class on the popup itself (e.g. a wider, formatted hint). */
  contentClass?: string;
  /**
   * Force the popup shut (e.g. while a palette drag is in progress) without unmounting
   * the trigger. The open state is still ours, so re-enabling it leaves the tooltip's
   * normal hover/focus behaviour intact.
   */
  disabled?: boolean;
  children: JSX.Element;
}) {
  const portal = createPopupMount();
  const [open, setOpen] = createSignal(false);
  const shown = () => open() && !props.disabled;
  // Forcing the popup shut when `disabled` flips on must also clear our own state, so
  // re-enabling it does not pop the tooltip back up without a hover.
  createEffect(() => {
    if (props.disabled) setOpen(false);
  });
  // A scroll (wheel or scrollbar) moves the trigger away from the popup's anchored
  // position; close it instead of leaving the hint floating over the content the user
  // is trying to reach.
  createEffect(() => {
    if (!shown()) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("wheel", close, { capture: true, passive: true });
    onCleanup(() => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("wheel", close, true);
    });
  });
  onMount(portal.refresh);
  useAnchorLifetime({ anchor: portal.anchor, open: shown, onClose: () => setOpen(false) });

  return (
    <KTooltip
      open={shown()}
      placement={props.placement ?? "bottom"}
      gutter={6}
      openDelay={400}
      closeDelay={0}
      onOpenChange={(isOpen) => {
        if (isOpen && props.disabled) return;
        setOpen(isOpen);
        if (isOpen) portal.refresh();
      }}
    >
      <KTooltip.Trigger ref={portal.ref} as="span" class={`tooltip-anchor ${props.class ?? ""}`}>
        {props.children}
      </KTooltip.Trigger>
      <KTooltip.Portal mount={portal.mount()}>
        <KTooltip.Content class={`tooltip-content ${props.contentClass ?? ""}`}>
          <Show when={props.shortcut} fallback={props.label}>
            <span class="tooltip-label-row">
              {props.label}
              <kbd class="tooltip-shortcut">{props.shortcut}</kbd>
            </span>
          </Show>
        </KTooltip.Content>
      </KTooltip.Portal>
    </KTooltip>
  );
}
