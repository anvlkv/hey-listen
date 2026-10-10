import { Popover as KPopover } from "@kobalte/core/popover";
import type { JSX } from "solid-js";
import { createPopupMount } from "../lib/popupMount";

/**
 * Popover — a thin wrapper over Kobalte's `Popover` (ADR-8): a trigger button and
 * a portaled panel, so analyzer params/about popovers escape the Workbench panel.
 * Styling is ours via the `pop-*` classes; Kobalte handles focus, dismissal and
 * positioning.
 *
 * The panel is portaled into the *trigger's* document (`mount`), so a popped-out
 * analyzer tab still opens its popover in the secondary window, not the main one.
 */
export default function Popover(props: {
  label: string;
  title?: string;
  class?: string;
  panelClass?: string;
  children: JSX.Element;
}) {
  const portal = createPopupMount();

  return (
    <KPopover
      placement="bottom-end"
      gutter={6}
      onOpenChange={(isOpen) => {
        if (isOpen) portal.refresh();
      }}
    >
      <KPopover.Trigger
        ref={portal.ref}
        class={`pop-trigger ${props.class ?? ""}`}
        title={props.title}
      >
        {props.label}
      </KPopover.Trigger>
      <KPopover.Portal mount={portal.mount()}>
        <KPopover.Content class={`pop-panel ${props.panelClass ?? ""}`}>
          <KPopover.Arrow class="pop-arrow" />
          {props.children}
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
}
