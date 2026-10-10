import { createSignal } from "solid-js";

/**
 * Resolve the document a portaled overlay (popover / select / combobox) should
 * mount into, so it opens in the same window as its trigger.
 *
 * The Workbench tabs are the only tabbed region, and a tab can be popped out into
 * its own window (dockview). A popout shares this JS context but lives in a
 * separate `window`/`document`, so the trigger's `ownerDocument` is that popout's
 * document once dockview adopts the node. Kobalte's portals default to
 * `document.body` — the *main* window's body — which would land the overlay in the
 * wrong window.
 *
 * Put [`ref`] on the trigger element and call [`refresh`] from the component's
 * `onOpenChange`. The trigger may be adopted into another document only after its
 * first render, so the mount must be re-resolved at open time rather than once at
 * mount.
 */
export function createPopupMount() {
  let element: HTMLElement | undefined;
  const [mount, setMount] = createSignal<HTMLElement | undefined>(undefined);

  return {
    ref: (node: HTMLElement) => {
      element = node;
    },
    refresh: () => {
      setMount(element?.ownerDocument?.body ?? document.body);
    },
    mount,
  };
}
