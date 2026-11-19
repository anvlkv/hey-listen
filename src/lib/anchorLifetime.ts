import { createEffect, onCleanup } from "solid-js";

/** What an overlay wrapper tells [`useAnchorLifetime`] about itself. */
export interface AnchorLifetimeOptions {
  /** The overlay's trigger element, or `undefined` before it has rendered. */
  anchor: () => HTMLElement | undefined;
  /** The overlay's open state; nothing is observed while this is `false`. */
  open: () => boolean;
  /** Close the overlay (the Kobalte root's open setter). Called at most once per open. */
  onClose: () => void;
}

/**
 * Close a portaled overlay as soon as its anchor leaves the document.
 *
 * A Kobalte overlay here is *uncontrolled* on the open side and shuts through the
 * anchor: `pointerleave` / `blur` / `click` on the trigger, or the portaled content's
 * own dismissal. None of those can happen to a trigger that is no longer in the DOM,
 * and Kobalte never asks whether the anchor is still attached (no `isConnected`, no
 * `MutationObserver` anywhere in `@kobalte/core`), so the overlay only disappears when
 * its Solid *owner* is disposed — every portal is `<Show when={contentPresent}>` inside
 * the root. Dockview breaks that assumption: a popped-out group moves the panel DOM
 * into another `document` (`externalDocument.body.appendChild(container)` in
 * `dockview-core`), which adopts the nodes instead of unmounting them, so the owner
 * outlives the move and a tooltip or popover opened in the tab keeps floating over
 * whatever is left.
 *
 * The watch is installed only while the overlay is open — a permanent observer per
 * trigger would mean hundreds — and torn down when it closes or its owner is disposed,
 * so it never leaks. It closes the overlay when the anchor is out of its document or
 * was moved to another one, and when that document's window loses focus (Kobalte
 * dismisses on outside pointerdown only, so a tooltip could otherwise outlive an app
 * switch). Call it once, at the top of an overlay wrapper:
 *
 * ```ts
 * useAnchorLifetime({ anchor: portal.anchor, open, onClose: () => setOpen(false) });
 * ```
 */
export function useAnchorLifetime(options: AnchorLifetimeOptions): void {
  createEffect(() => {
    const anchor = options.anchor();
    if (!anchor || !options.open()) return;

    // Where the overlay is portaled and where the removal shows up. A popout's trigger
    // reports its own document here, so each window watches itself.
    const doc = anchor.ownerDocument;
    const win = doc.defaultView;

    let stopped = false;

    // The anchor usually goes away with an *ancestor* (a tab, a panel, a whole view), so
    // the document itself is observed. A node is also disconnected for an instant while
    // it is adopted into a popout document, hence the second test: an inter-document move
    // counts as gone, a reorder within the same document does not.
    const check = () => {
      if (!anchor.isConnected || anchor.ownerDocument !== doc) close();
    };

    const observer = new MutationObserver(check);

    /** Teardown only — for a closed overlay or an unmount, never a close. */
    const stop = () => {
      if (stopped) return false;
      stopped = true;
      observer.disconnect();
      win?.removeEventListener("blur", close);
      return true;
    };

    const close = () => {
      if (stop()) options.onClose();
    };

    observer.observe(doc, { childList: true, subtree: true });
    win?.addEventListener("blur", close);
    onCleanup(stop);

    // The anchor may already be gone when the overlay opens, e.g. a click that unmounts
    // a view and opens an overlay inside it in the same update.
    check();
  });
}
