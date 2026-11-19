import { Popover as KPopover } from "@kobalte/core/popover";
import { createSignal } from "solid-js";
import Icon from "../Icon";
import Tooltip from "../Tooltip";
import { useAnchorLifetime } from "../../lib/anchorLifetime";
import { createPopupMount } from "../../lib/popupMount";
import { source } from "../../state/source";
import WindowFields from "./WindowFields";

/**
 * The Timeline toolbar's **window-edit** trigger (D-05): a small icon button that sits
 * immediately after the read-only `.timeline-readout` and opens [`WindowFields`] in a
 * portaled popover. The panel is mounted into the trigger's own document, so it also
 * works from a popped-out window (see `lib/popupMount.ts`), and it closes with the
 * trigger (see `lib/anchorLifetime.ts`).
 */
export default function WindowEditPopover() {
  const portal = createPopupMount();
  const [open, setOpen] = createSignal(false);
  useAnchorLifetime({ anchor: portal.anchor, open, onClose: () => setOpen(false) });

  return (
    <KPopover
      open={open()}
      placement="bottom-start"
      gutter={6}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (isOpen) portal.refresh();
      }}
    >
      <Tooltip label="Edit the window start, end and duration">
        <KPopover.Trigger
          ref={portal.ref}
          class="timeline-btn icon-btn"
          data-testid="timeline.windowEdit"
          aria-label="Edit the analysis window numerically"
          disabled={!source()}
        >
          <Icon name="pen-to-square" />
        </KPopover.Trigger>
      </Tooltip>
      <KPopover.Portal mount={portal.mount()}>
        <KPopover.Content class="pop-panel">
          <KPopover.Arrow class="pop-arrow" />
          <WindowFields />
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
}
