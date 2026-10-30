import { createEffect, createRoot, createSignal, on } from "solid-js";
import { invoke } from "../../lib/ipc";
import { analyzerById } from "../analyzer/lookup";
import type { AnalyzerId } from "../analyzer/types";
import { dockApi, openTools } from "../workbench";
import { comparePanelId, isCompareId, parseCompareTool } from "./id";
import type { CompareViewDto } from "./types";

/**
 * Open compare views (M25).
 *
 * A comparison is a **transient** Workbench tab in the owner project, `compare:<tool>`
 * (or its popout), one per tool. Its reference is held here — never in the project
 * file — and a popout's reference lives in the core (a popout is a native window with
 * no Workbench). See `docs/comparison.md`.
 */

/** Tool id → the reference project's window label, for **open compare tabs**. */
export const [compareRefs, setCompareRefs] = createSignal<Record<string, string>>({});

/** The reference label a compare tab is bound to, or `null`. */
export function referenceFor(tool: AnalyzerId): string | null {
  return compareRefs()[tool] ?? null;
}

/** Point an open compare tab at another reference project. */
export function setReference(tool: AnalyzerId, reference: string) {
  setCompareRefs((refs) => ({ ...refs, [tool]: reference }));
}

/** Forget a compare tab's reference (closed / popped out). */
export function clearReference(tool: AnalyzerId) {
  setCompareRefs((refs) => {
    if (!(tool in refs)) return refs;
    const next = { ...refs };
    delete next[tool];
    return next;
  });
}

/** The open compare **tabs**, as `{ tool, with }` (the popouts come from the core). */
export function openCompareTabs(): CompareViewDto[] {
  return openTools()
    .filter((id) => isCompareId(id))
    .flatMap((id) => {
      const tool = parseCompareTool(id);
      if (!tool) return [];
      return [{ tool, with: compareRefs()[tool] ?? "" }];
    });
}

/**
 * Open (or focus) `tool`'s comparison against `reference`.
 *
 * A tab that is already open is retargeted; a compare popout already showing the tool
 * is raised/retargeted by the core; otherwise a new tab opens in the main grid.
 */
export async function openCompare(tool: AnalyzerId, reference: string) {
  const panel = dockApi()?.getPanel(comparePanelId(tool));
  if (panel) {
    setReference(tool, reference);
    panel.api.setActive();
    return;
  }
  const popouts = await invoke<CompareViewDto[]>("compare_popouts").catch(() => []);
  if (popouts.some((view) => view.tool === tool)) {
    await invoke("open_compare_popout", { tool, reference }).catch((err) =>
      console.error("could not retarget the compare window", err),
    );
    return;
  }
  addCompareTab(tool);
  setReference(tool, reference);
}

/** Move the compare tab into a native compare window (the tab closes). */
export async function popoutCompare(tool: AnalyzerId) {
  const reference = referenceFor(tool);
  if (!reference) return;
  try {
    await invoke("open_compare_popout", { tool, reference });
    dockApi()?.getPanel(comparePanelId(tool))?.api.close();
    clearReference(tool);
  } catch (err) {
    console.error("could not pop out the comparison", err);
  }
}

/** Close the compare tab (a popout closes with its own window). */
export function closeCompare(tool: AnalyzerId) {
  dockApi()?.getPanel(comparePanelId(tool))?.api.close();
  clearReference(tool);
}

/** Add the compare panel to the main grid — never into a popped-out group. */
function addCompareTab(tool: AnalyzerId) {
  const api = dockApi();
  if (!api) return;
  const grid = api.groups.find((group) => group.api.location.type === "grid");
  api.addPanel({
    id: comparePanelId(tool),
    // The panel id doubles as the component name, so the Workbench's renderer can tell
    // a compare view from an analyzer by the id alone.
    component: comparePanelId(tool),
    title: `Compare: ${analyzerById(tool).title}`,
    params: { tool },
    ...(grid ? { position: { referenceGroup: grid, direction: "within" as const } } : {}),
  });
}

// Drop a stale reference when its compare tab is closed (dockview's own close button,
// a layout restore, or `closeCompare`). Popping out clears it explicitly.
createRoot(() => {
  createEffect(
    on(openTools, (ids) => {
      const open = new Set<string>(ids.filter((id) => isCompareId(id)));
      setCompareRefs((refs) => {
        const next: Record<string, string> = {};
        for (const [tool, reference] of Object.entries(refs)) {
          if (open.has(comparePanelId(tool as AnalyzerId))) next[tool] = reference;
        }
        // Keep the same object when nothing was dropped (a new identity would repaint
        // every consumer of the refs).
        return Object.keys(next).length === Object.keys(refs).length ? refs : next;
      });
    }),
  );
});
