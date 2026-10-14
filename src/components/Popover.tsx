import { Popover as KPopover } from "@kobalte/core/popover";
import type { JSX } from "solid-js";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import type { IconName } from "../lib/icons";
import { createPopupMount } from "../lib/popupMount";

/**
 * Popover — a thin wrapper over Kobalte's `Popover` (ADR-8): a trigger and a portaled
 * panel, so analyzer params/about popovers escape the Workbench panel. Styling is ours
 * via the `pop-*` classes; Kobalte handles focus, dismissal and positioning.
 *
 * The trigger is either a text label or, when `icon` is given, an icon-only button —
 * in both cases a [`Tooltip`](./Tooltip.tsx) surfaces `title` (replacing the native
 * `title` attribute, which looked out of place next to the app's own tooltips).
 *
 * The panel is portaled into the *trigger's* document (`mount`), so a popped-out
 * analyzer tab still opens its popover in the secondary window, not the main one.
 */
export default function Popover(props: {
  /** The trigger's label — its visible text, or its accessible name when `icon` is set. */
  label: string;
  /** Hover hint (shown by the Tooltip). */
  title?: string;
  /** When set, the trigger shows only this icon (with `label` as its `aria-label`). */
  icon?: IconName;
  class?: string;
  panelClass?: string;
  /** Optional `data-testid` on the trigger button (for the E2E suite). */
  testid?: string;
  /** Called when the panel opens (e.g. to refresh the content's data). */
  onOpen?: () => void;
  children: JSX.Element;
}) {
  const portal = createPopupMount();

  // The trigger MUST stay inline (not hoisted into a variable): Solid evaluates a
  // hoisted JSX expression eagerly, before `<KPopover>` has provided its context, so
  // `Popover.Trigger` would throw "usePopoverContext must be used within a Popover".
  // As an inline child it is a lazy getter, evaluated inside the provider.
  return (
    <KPopover
      placement="bottom-end"
      gutter={6}
      onOpenChange={(isOpen) => {
        if (isOpen) {
          portal.refresh();
          props.onOpen?.();
        }
      }}
    >
      <Tooltip label={props.title ?? props.label}>
        <KPopover.Trigger
          ref={portal.ref}
          class={`pop-trigger ${props.icon ? "pop-trigger-icon" : ""} ${props.class ?? ""}`}
          aria-label={props.label}
          data-testid={props.testid}
        >
          {props.icon ? <Icon name={props.icon} /> : props.label}
        </KPopover.Trigger>
      </Tooltip>
      <KPopover.Portal mount={portal.mount()}>
        <KPopover.Content class={`pop-panel ${props.panelClass ?? ""}`}>
          <KPopover.Arrow class="pop-arrow" />
          {props.children}
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
}
