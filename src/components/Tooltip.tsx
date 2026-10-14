import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { onMount, type JSX } from "solid-js";
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
 * ```tsx
 * <Tooltip label="Zoom in">
 *   <Button …><Icon name="expand" /></Button>
 * </Tooltip>
 * ```
 */
export default function Tooltip(props: {
  label: JSX.Element;
  placement?: "top" | "bottom" | "left" | "right";
  class?: string;
  children: JSX.Element;
}) {
  const portal = createPopupMount();
  onMount(portal.refresh);

  return (
    <KTooltip
      placement={props.placement ?? "bottom"}
      gutter={6}
      openDelay={400}
      closeDelay={0}
      onOpenChange={(isOpen) => {
        if (isOpen) portal.refresh();
      }}
    >
      <KTooltip.Trigger ref={portal.ref} as="span" class={`tooltip-anchor ${props.class ?? ""}`}>
        {props.children}
      </KTooltip.Trigger>
      <KTooltip.Portal mount={portal.mount()}>
        <KTooltip.Content class="tooltip-content">{props.label}</KTooltip.Content>
      </KTooltip.Portal>
    </KTooltip>
  );
}
