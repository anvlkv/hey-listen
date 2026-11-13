import { createSignal } from "solid-js";
import { invoke } from "../../lib/ipc";
import type { CompareViewDto } from "./types";

/**
 * A **compare popout** (M25): a native window showing one comparison, aliased to its
 * owner project. Rust registers it with its `(tool, id, reference)` rather than as a
 * tool popout, so it is never saved, restored or raised as an analyzer tab; the window
 * asks [`loadComparePopout`] what it shows and retargets through the core. Several
 * comparisons of one tool may be open, so the stable `id` identifies the pair.
 * See `docs/comparison.md` → "Popout".
 */

/** The compare view this window shows, or `null` for any other window. */
export const [comparePopoutView, setComparePopoutView] = createSignal<CompareViewDto | null>(null);

/** Ask the core which comparison this window pops out. */
export async function loadComparePopout(): Promise<CompareViewDto | null> {
  const view = await invoke<CompareViewDto | null>("popout_compare").catch(() => null);
  setComparePopoutView(view);
  return view;
}

/** Change this popout's binding (the core also raises/retargets a duplicate). */
export async function retargetComparePopout(reference: string, saved = false, id?: string) {
  await invoke("retarget_compare_popout", { id: id ?? null, reference, saved });
  // Re-read the core's view: a saved target adopts its snapshot's id.
  await loadComparePopout();
}
