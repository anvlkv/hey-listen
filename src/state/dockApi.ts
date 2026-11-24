import { createSignal } from "solid-js";
import type { DockviewApi } from "dockview";

/**
 * The Workbench's dockview API, set while it is mounted (`null` in a popout window, which
 * has no Workbench, and between mounts).
 *
 * Kept apart from `state/workbench.ts` so a view helper that closes a tab — the popout
 * action — can reach it without importing the tab registry.
 */
export const [dockApi, setDockApi] = createSignal<DockviewApi | null>(null);
