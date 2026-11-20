import { createEffect, createRoot, createSignal, on } from "solid-js";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import { invoke } from "../../lib/ipc";
import { analyzerById } from "../analyzer/lookup";
import type { AnalyzerId } from "../analyzer/types";
import { dockApi, openCompareIds } from "../workbench";
import { comparePanelId, newCompareId, parseComparePanel } from "./id";
import type { CompareViewDto } from "./types";

/**
 * Open compare views (M23 Phase 3).
 *
 * A comparison is a **transient** Workbench tab in the owner project,
 * `compare:<tool>:<id>` (or its popout). Several distinct comparisons — one per
 * reference pair — can be open for one analyzer, so every entry here is keyed by the
 * comparison's **id**, not its tool. Its reference binding — a live project label, or a
 * saved snapshot — is held here (a tab) or in the core (a popout). The fine-tune offset
 * and the last successful snapshot fingerprint are per view, so the project's dirty
 * signature follows a settled reference change. See `docs/comparison.md`.
 */

/** What a compare view compares against. */
export type CompareBinding =
  { kind: "live"; reference: string } | { kind: "saved"; reference: string };

/** One open compare tab's state. */
export interface CompareViewState {
  /** The analyzer this comparison runs (several comparisons may share one). */
  tool: AnalyzerId;
  binding: CompareBinding;
  /** The fine-tune offset δ in seconds (positive = the reference is later). */
  offset: number;
  /** The content fingerprint of the last successful comparison, or `null`. */
  fingerprint: string | null;
}

/** Comparison id → the state of its **open compare tab**. */
export const [compareViews, setCompareViews] = createSignal<Record<string, CompareViewState>>({});

/** The complete state of one comparison, or `null`. */
export function viewFor(tool: AnalyzerId, id: string): CompareViewState | null {
  const view = compareViews()[id];
  return view && view.tool === tool ? view : null;
}

/** The fine-tune offset of a comparison (0 when it has none). */
export function compareOffset(tool: AnalyzerId, id: string): number {
  return viewFor(tool, id)?.offset ?? 0;
}

/** Point a comparison at a live reference project; a retarget resets the offset. */
export function setReference(tool: AnalyzerId, id: string, reference: string) {
  setCompareViews((views) => {
    const current = views[id];
    // Re-selecting the same reference (an MCP call following the UI) is not a retarget:
    // keep the user's fine-tune offset.
    if (
      current?.tool === tool &&
      current.binding.kind === "live" &&
      current.binding.reference === reference
    ) {
      return views;
    }
    return {
      ...views,
      [id]: {
        tool,
        binding: { kind: "live", reference },
        offset: 0,
        fingerprint: current?.fingerprint ?? null,
      },
    };
  });
}

/** Point a comparison at the project's saved snapshot, restoring its offset. */
export function setSavedReference(tool: AnalyzerId, id: string, info: SavedComparisonInfo) {
  setCompareViews((views) => ({
    ...views,
    [id]: {
      tool,
      binding: { kind: "saved", reference: info.referenceName },
      offset: info.bOffset,
      fingerprint: info.fingerprint,
    },
  }));
}

/** Move a view's fine-tune offset. */
export function setCompareOffset(tool: AnalyzerId, id: string, seconds: number) {
  setCompareViews((views) => {
    const view = views[id];
    if (!view || view.tool !== tool || view.offset === seconds) return views;
    return { ...views, [id]: { ...view, offset: seconds } };
  });
}

/** Record the last successful comparison's fingerprint (dirty tracking). */
export function setCompareFingerprint(tool: AnalyzerId, id: string, fingerprint: string) {
  setCompareViews((views) => {
    const view = views[id];
    if (!view || view.tool !== tool || view.fingerprint === fingerprint) return views;
    return { ...views, [id]: { ...view, fingerprint } };
  });
}

/** Forget a comparison's state (closed / popped out). */
export function clearReference(tool: AnalyzerId, id: string) {
  setCompareViews((views) => {
    if (views[id]?.tool !== tool) return views;
    const next = { ...views };
    delete next[id];
    return next;
  });
}

/**
 * The save-time signature of the open comparisons: one `kind|reference|offset|fingerprint`
 * string per view. The core's dirty signature reads it (pushed as `compareSignature`), so
 * a settled change in a live reference marks the project dirty.
 */
export function compareSignature(): Record<string, string> {
  const signature: Record<string, string> = {};
  for (const [id, view] of Object.entries(compareViews())) {
    signature[id] = [
      view.binding.kind,
      view.binding.reference,
      view.offset.toFixed(6),
      view.fingerprint ?? "",
    ].join("|");
  }
  return signature;
}

/**
 * The open compare **tabs**, with their binding and offset (popouts come from the core).
 * This is what `get_state.compare` reports; compare ids are never in `openTools`.
 */
export function openCompareTabs(): CompareViewDto[] {
  return openCompareIds().flatMap((panelId) => {
    const ref = parseComparePanel(panelId);
    if (!ref) return [];
    const view = viewFor(ref.tool, ref.id);
    const binding = view?.binding;
    return [
      {
        id: ref.id,
        tool: ref.tool,
        with: binding?.reference ?? "",
        saved: binding?.kind === "saved",
        offset: view?.offset ?? 0,
      },
    ];
  });
}

/** The project's saved comparisons for `tool` (several per tool). */
export async function fetchSaved(tool: AnalyzerId): Promise<SavedComparisonInfo[]> {
  return invoke<SavedComparisonInfo[]>("compare_saved", { tool }).catch((err) => {
    console.error("could not read the saved comparisons", err);
    return [] as SavedComparisonInfo[];
  });
}

/** The latest saved snapshot of `tool`, or `null`. */
function latestSaved(infos: SavedComparisonInfo[]): SavedComparisonInfo | null {
  return infos.length > 0 ? infos[infos.length - 1] : null;
}

/**
 * Open a **new** comparison of `tool` against `reference`.
 *
 * A panel for the same comparison id is retargeted (a repeated call), while a fresh
 * call gets a new id and therefore its own tab. A compare popout showing the same id is
 * raised/retargeted by the core.
 */
export async function openCompare(
  tool: AnalyzerId,
  reference: string,
  id: string = newCompareId(),
): Promise<string> {
  const panel = dockApi()?.getPanel(comparePanelId(tool, id));
  if (panel) {
    setReference(tool, id, reference);
    panel.api.setActive();
    return id;
  }
  const popouts = await invoke<CompareViewDto[]>("compare_popouts").catch(() => []);
  if (popouts.some((view) => view.id === id)) {
    await invoke("open_compare_popout", { tool, id, reference, saved: false }).catch((err) =>
      console.error("could not retarget the compare window", err),
    );
    return id;
  }
  addCompareTab(tool, id);
  setReference(tool, id, reference);
  return id;
}

/**
 * Bring the reference project into view (M25.D): raise its window when the reference is
 * live, otherwise open the project file recorded with the comparison's saved snapshot.
 * The core never guesses a project from its name — a saved reference without a recorded
 * file, or one whose file is gone, rejects with a readable message (shown as a notice).
 */
export async function showReference(
  binding: CompareBinding,
  tool: AnalyzerId,
  id: string,
): Promise<string> {
  return invoke<string>("open_reference_window", {
    label: binding.kind === "live" ? binding.reference : null,
    tool: binding.kind === "saved" ? tool : null,
    id: binding.kind === "saved" ? id : null,
  });
}

/**
 * Open a comparison bound to a **saved** snapshot.
 *
 * With an `id`, an existing tab is rebound (a saved snapshot keeps its own id); without
 * one, a new tab opens on the latest saved snapshot. `info` names the exact snapshot to
 * bind when the caller picked one.
 */
export async function openCompareSaved(
  tool: AnalyzerId,
  id?: string,
  info?: SavedComparisonInfo,
): Promise<boolean> {
  let snapshot = info;
  if (!snapshot) {
    const infos = await fetchSaved(tool);
    const match = id ? infos.find((entry) => entry.id === id) : undefined;
    snapshot = match ?? latestSaved(infos) ?? undefined;
  }
  if (!snapshot) return false;
  const targetId = id ?? snapshot.id;
  const panel = dockApi()?.getPanel(comparePanelId(tool, targetId));
  if (panel) {
    setSavedReference(tool, targetId, snapshot);
    panel.api.setActive();
    return true;
  }
  const popouts = await invoke<CompareViewDto[]>("compare_popouts").catch(() => []);
  if (popouts.some((view) => view.id === targetId)) {
    await invoke("open_compare_popout", {
      tool,
      id: targetId,
      reference: snapshot.referenceName,
      saved: true,
    }).catch((err) => console.error("could not retarget the compare window", err));
    return true;
  }
  addCompareTab(tool, targetId);
  setSavedReference(tool, targetId, snapshot);
  return true;
}

/** Move the compare tab into a native compare window (the tab closes). */
export async function popoutCompare(tool: AnalyzerId, id: string) {
  const view = viewFor(tool, id);
  if (!view) return;
  try {
    await invoke("open_compare_popout", {
      tool,
      id,
      reference: view.binding.reference,
      saved: view.binding.kind === "saved",
    });
    dockApi()?.getPanel(comparePanelId(tool, id))?.api.close();
    clearReference(tool, id);
  } catch (err) {
    console.error("could not pop out the comparison", err);
  }
}

/** Close the compare tab (a popout closes with its own window). */
export function closeCompare(tool: AnalyzerId, id: string) {
  dockApi()?.getPanel(comparePanelId(tool, id))?.api.close();
  clearReference(tool, id);
}

/**
 * Restore a loaded project's comparisons: **one tab per saved pair** (several per tool),
 * bound to its saved reference until the user reconnects a live project.
 */
export function restoreSavedComparisons(infos: SavedComparisonInfo[]) {
  for (const info of infos) {
    addCompareTab(info.tool, info.id);
    setSavedReference(info.tool, info.id, info);
  }
}

/** Add the compare panel to the main grid — never into a popped-out group. */
export function addCompareTab(tool: AnalyzerId, id: string) {
  const api = dockApi();
  if (!api) return;
  const panelId = comparePanelId(tool, id);
  const grid = api.groups.find((group) => group.api.location.type === "grid");
  api.addPanel({
    id: panelId,
    // The panel id doubles as the component name, so the Workbench's renderer can tell
    // a compare view from an analyzer by the id alone.
    component: panelId,
    title: `Compare: ${analyzerById(tool).title}`,
    params: { tool, id },
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
 * Keep only the views whose comparison tab is still open.
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
  const openIds = new Set(open.flatMap((panelId) => parseComparePanel(panelId)?.id ?? []));
  let dropped = false;
  const next: Record<string, CompareViewState> = {};
  for (const [id, view] of Object.entries(views)) {
    if (openIds.has(id)) next[id] = view;
    else dropped = true;
  }
  return dropped ? next : views;
}
