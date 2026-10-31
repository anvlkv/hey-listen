import { createEffect, createRoot, createSignal, on } from "solid-js";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import { invoke } from "../../lib/ipc";
import { analyzerById } from "../analyzer/lookup";
import type { AnalyzerId } from "../analyzer/types";
import { dockApi, openCompareIds } from "../workbench";
import { comparePanelId, parseCompareTool } from "./id";
import type { CompareViewDto } from "./types";

/**
 * Open compare views (M25; saved references in M25.C).
 *
 * A comparison is a **transient** Workbench tab in the owner project, `compare:<tool>`
 * (or its popout), one per tool. Its reference binding — a live project label, or the
 * project's **saved snapshot** — is held here (a tab) or in the core (a popout). The
 * fine-tune offset and the last successful snapshot fingerprint are per view, so the
 * project's dirty signature follows a settled reference change.
 * See `docs/comparison.md`.
 */

/** What a compare view compares against. */
export type CompareBinding =
  { kind: "live"; reference: string } | { kind: "saved"; reference: string };

/** One open compare tab's state. */
export interface CompareViewState {
  binding: CompareBinding;
  /** The fine-tune offset δ in seconds (positive = the reference is later). */
  offset: number;
  /** The content fingerprint of the last successful comparison, or `null`. */
  fingerprint: string | null;
}

/** Tool id → the state of its **open compare tab**. */
export const [compareViews, setCompareViews] = createSignal<Record<string, CompareViewState>>({});

/** The complete state of a tool's compare tab, or `null`. */
export function viewFor(tool: AnalyzerId): CompareViewState | null {
  return compareViews()[tool] ?? null;
}

/** The fine-tune offset of a tool's compare tab (0 when it has none). */
export function compareOffset(tool: AnalyzerId): number {
  return viewFor(tool)?.offset ?? 0;
}

/** Point a compare tab at a live reference project; a retarget resets the offset. */
export function setReference(tool: AnalyzerId, reference: string) {
  setCompareViews((views) => {
    const current = views[tool];
    // Re-selecting the same reference (an MCP call following the UI) is not a retarget:
    // keep the user's fine-tune offset.
    if (current?.binding.kind === "live" && current.binding.reference === reference) {
      return views;
    }
    return {
      ...views,
      [tool]: {
        binding: { kind: "live", reference },
        offset: 0,
        fingerprint: current?.fingerprint ?? null,
      },
    };
  });
}

/** Point a compare tab at the project's saved snapshot, restoring its offset. */
export function setSavedReference(tool: AnalyzerId, info: SavedComparisonInfo) {
  setCompareViews((views) => ({
    ...views,
    [tool]: {
      binding: { kind: "saved", reference: info.referenceName },
      offset: info.bOffset,
      fingerprint: info.fingerprint,
    },
  }));
}

/** Move the view's fine-tune offset. */
export function setCompareOffset(tool: AnalyzerId, seconds: number) {
  setCompareViews((views) => {
    const view = views[tool];
    if (!view || view.offset === seconds) return views;
    return { ...views, [tool]: { ...view, offset: seconds } };
  });
}

/** Record the last successful comparison's fingerprint (dirty tracking). */
export function setCompareFingerprint(tool: AnalyzerId, fingerprint: string) {
  setCompareViews((views) => {
    const view = views[tool];
    if (!view || view.fingerprint === fingerprint) return views;
    return { ...views, [tool]: { ...view, fingerprint } };
  });
}

/** Forget a compare tab's state (closed / popped out). */
export function clearReference(tool: AnalyzerId) {
  setCompareViews((views) => {
    if (!(tool in views)) return views;
    const next = { ...views };
    delete next[tool];
    return next;
  });
}

/** The save-time signature of the open compare views (see `project/dirty.ts`). */
export function compareSignature(): Record<string, string> {
  const signature: Record<string, string> = {};
  for (const [tool, view] of Object.entries(compareViews())) {
    signature[tool] = [
      view.binding.kind,
      view.binding.reference,
      view.offset.toFixed(6),
      view.fingerprint ?? "",
    ].join("|");
  }
  return signature;
}

/**
 * The open compare **tabs**, as `{ tool, with, saved, offset }` (popouts come from the
 * core). This is what `get_state.compare` reports; compare ids are never in `openTools`.
 */
export function openCompareTabs(): CompareViewDto[] {
  return openCompareIds().flatMap((id) => {
    const tool = parseCompareTool(id);
    if (!tool) return [];
    const view = viewFor(tool);
    const binding = view?.binding;
    return [
      {
        tool,
        with: binding?.reference ?? "",
        saved: binding?.kind === "saved",
        offset: view?.offset ?? 0,
      },
    ];
  });
}

/** The project's saved snapshot for `tool`, if the core has one. */
export async function fetchSaved(tool: AnalyzerId): Promise<SavedComparisonInfo | null> {
  const list = await invoke<SavedComparisonInfo[]>("compare_saved", { tool }).catch((err) => {
    console.error("could not read the saved comparison", err);
    return [] as SavedComparisonInfo[];
  });
  return list[0] ?? null;
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
    await invoke("open_compare_popout", { tool, reference, saved: false }).catch((err) =>
      console.error("could not retarget the compare window", err),
    );
    return;
  }
  addCompareTab(tool);
  setReference(tool, reference);
}

/** Open (or retarget) `tool`'s comparison against the project's saved snapshot. */
export async function openCompareSaved(tool: AnalyzerId): Promise<boolean> {
  const info = await fetchSaved(tool);
  if (!info) return false;
  const panel = dockApi()?.getPanel(comparePanelId(tool));
  if (panel) {
    setSavedReference(tool, info);
    panel.api.setActive();
    return true;
  }
  const popouts = await invoke<CompareViewDto[]>("compare_popouts").catch(() => []);
  if (popouts.some((view) => view.tool === tool)) {
    await invoke("open_compare_popout", {
      tool,
      reference: info.referenceName,
      saved: true,
    }).catch((err) => console.error("could not retarget the compare window", err));
    return true;
  }
  addCompareTab(tool);
  setSavedReference(tool, info);
  return true;
}

/** Move the compare tab into a native compare window (the tab closes). */
export async function popoutCompare(tool: AnalyzerId) {
  const view = viewFor(tool);
  if (!view) return;
  try {
    await invoke("open_compare_popout", {
      tool,
      reference: view.binding.reference,
      saved: view.binding.kind === "saved",
    });
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

/**
 * Restore the comparisons saved in a loaded project (M25.C): one tab per snapshot,
 * bound to the saved reference until the user reconnects a live project.
 */
export function restoreSavedComparisons(infos: SavedComparisonInfo[]) {
  for (const info of infos) {
    addCompareTab(info.tool);
    setSavedReference(info.tool, info);
  }
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

// Drop stale state when a compare tab is closed (dockview's own close button, a layout
// restore, or `closeCompare`). Popping out clears it explicitly.
//
// Prune against the **live API** on the next microtask: dockview can emit a
// remove+add pair while it moves a panel, and pruning on the transient empty signal
// would drop a view that is still bound.
createRoot(() => {
  createEffect(
    on(openCompareIds, () => {
      queueMicrotask(() => {
        const open = (dockApi()?.panels ?? []).map((panel) => panel.id);
        setCompareViews((views) => pruneViews(views, open));
      });
    }),
  );
});

/**
 * Keep only the views whose compare tab is still open.
 *
 * Tracks the **compare** panel ids, not `openTools` — compare ids are deliberately
 * excluded from `openTools`, and reading them there dropped every reference on any
 * panel add/remove (M25.B). Returns the same object when nothing was dropped, so the
 * views' consumers do not repaint for nothing.
 */
export function pruneViews(
  views: Record<string, CompareViewState>,
  open: readonly string[],
): Record<string, CompareViewState> {
  const openIds = new Set(open);
  const next: Record<string, CompareViewState> = {};
  for (const [tool, view] of Object.entries(views)) {
    if (openIds.has(comparePanelId(tool as AnalyzerId))) next[tool] = view;
  }
  return Object.keys(next).length === Object.keys(views).length ? views : next;
}
