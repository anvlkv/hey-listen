import { Popover as KPopover } from "@kobalte/core/popover";
import type { JSX } from "solid-js";

/**
 * Popover — a thin wrapper over Kobalte's `Popover` (ADR-8): a trigger button and
 * a portaled panel, so analyzer params/about popovers escape the Workbench panel.
 * Styling is ours via the `pop-*` classes; Kobalte handles focus, dismissal and
 * positioning.
 */
export default function Popover(props: {
  label: string;
  title?: string;
  class?: string;
  panelClass?: string;
  children: JSX.Element;
}) {
  return (
    <KPopover placement="bottom-end" gutter={6}>
      <KPopover.Trigger class={`pop-trigger ${props.class ?? ""}`} title={props.title}>
        {props.label}
      </KPopover.Trigger>
      <KPopover.Portal>
        <KPopover.Content class={`pop-panel ${props.panelClass ?? ""}`}>
          <KPopover.Arrow class="pop-arrow" />
          {props.children}
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
}
