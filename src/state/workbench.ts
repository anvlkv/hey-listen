import { createSignal } from "solid-js";
import { invoke } from "../lib/ipc";
import { sanitizeLayout } from "../lib/dockviewLayout";
import type { DockviewApi, DockviewGroupPanel, SerializedDockview } from "dockview";
import { isAnalyzerId } from "./analyzer/lookup";
import type { AnalyzerId } from "./analyzer/types";
import { isCompareId } from "./compare/id";
import type { GraphScope } from "../lib/graph";
import {
  dropSystem,
  ensureSystem,
  systemScope,
  systemsUnder,
  type SubsystemScope,
} from "./subsystems";
import { parseTableScope, tableScope, type TableScope } from "./tables";
import { graphFor, hasGraph } from "./graphHandles";
import { nodeKind } from "../lib/graph";
import { rowCount, rowsOf } from "../lib/graph/table";
import { dockApi } from "./dockApi";
import { isSystemPanel, poppedViews, popoutView, systemTitle } from "./popout";
import { toolById, type ToolId } from "./tools";

/**
 * Workbench tab registry.
 *
 * The Workbench (`dockview`) is the only tabbed area. Its tabs are the **graph
 * editors** (filter / synth) plus the **analyzer tools** (M4+). This module lets
 * the Sidebar (a sibling region) open and focus a tab through the shared dockview
 * API.
 *
 * The tool table lives in `tools.ts` and the popout view helpers in `popout.ts`; both
 * are re-exported here so a caller keeps addressing the Workbench through one module.
 */

export { dockApi, setDockApi } from "./dockApi";
export { TOOLS, toolById, type ToolDef, type ToolId } from "./tools";
export {
  isGraphView,
  isPopoutView,
  isSystemPanel,
  popoutView,
  refreshPoppedViews,
  viewTitle,
} from "./popout";
export const [openTools, setOpenTools] = createSignal<ToolId[]>([]);
/**
 * Bumped on every dockview layout change (tab moves, splitter drags, a restore), so the
 * project-state push notices a layout edit without serializing the layout on every
 * reactive tick.
 */
export const [layoutRevision, setLayoutRevision] = createSignal(0);
/**
 * The open **compare** panel ids, in dockview order.
 *
 * `openTools` deliberately excludes them (they are not project content), but the
 * compare views still need to know which are open: deriving that from `openTools`
 * dropped every reference on any panel add/remove (M25.B). `syncOpenTools` is the one
 * place a layout change funnels through, so both signals are set there.
 */
export const [openCompareIds, setOpenCompareIds] = createSignal<string[]>([]);

/** The focused Workbench tool id, or `null` when nothing (or a compare/subsystem/table view) is focused. */
export function focusedTool(): ToolId | null {
  const id = dockApi()?.activePanel?.id;
  return id && !isCompareId(id) && !isSystemPanel(id) && !isTablePanel(id) ? (id as ToolId) : null;
}

/** The focused **analyzer** tab, or `null` (a graph tab, or nothing focused). */
export function focusedAnalyzer(): AnalyzerId | null {
  const tool = focusedTool();
  return tool && isAnalyzerId(tool) ? tool : null;
}

/**
 * Step the active group's active tab by `direction`, wrapping at the ends. A group with
 * fewer than two tabs has nowhere to go.
 */
export function cycleWorkbenchTab(direction: 1 | -1): void {
  const group = dockApi()?.activeGroup;
  if (!group || group.panels.length < 2) return;
  const active = group.activePanel;
  if (!active) return;
  const index = group.panels.indexOf(active);
  const next = group.panels[(index + direction + group.panels.length) % group.panels.length];
  next.api.setActive();
}

/**
 * Where a new tab goes: dockview's directions. `within` adds a tab to the group (the
 * default); the other four split that group and put the tab on that side of it.
 */
export const TOOL_DIRECTIONS = ["within", "left", "right", "above", "below"] as const;
export type ToolDirection = (typeof TOOL_DIRECTIONS)[number];

export function isToolDirection(value: unknown): value is ToolDirection {
  return typeof value === "string" && (TOOL_DIRECTIONS as readonly string[]).includes(value);
}

/** `open_tool`'s optional placement: dockview's `position`, addressed from the Workbench. */
export interface ToolPosition {
  /** A group id (`get_state.workbench.groups`), or a tool id open in that group. */
  referenceGroup?: string;
  /** `within` (default) adds a tab; the others split the group and place the tab there. */
  direction?: ToolDirection;
}

/** Open a tool's tab, or focus it if it is already open (no duplicate tabs). */
export async function openTool(id: ToolId, position?: ToolPosition) {
  const api = dockApi();
  if (!api) return;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  // A popped-out tool lives in its own window: selecting it must raise that window
  // instead of opening a duplicate tab here (no duplicate analyzer tabs).
  const raised = await invoke<boolean>("focus_popout", { view: id }).catch(() => false);
  if (raised) return;
  // New tools always open in the **main** window, even when a popout is focused.
  addToMainGrid(api, id, toolById(id).title, position);
}

/** Add a tool to the main window's grid — never into a popped-out group. */
function addToMainGrid(api: DockviewApi, id: string, title: string, position?: ToolPosition) {
  const reference = position?.referenceGroup
    ? requireGroup(api, position.referenceGroup)
    : mainGridGroup(api);
  if (reference) {
    api.addPanel({
      id,
      component: id,
      title,
      position: { referenceGroup: reference, direction: position?.direction ?? "within" },
    });
  } else {
    // Every group is popped out (or the grid is empty): create a fresh one.
    const group = api.addGroup();
    api.addPanel({
      id,
      component: id,
      title,
      position: { referenceGroup: group, direction: "within" },
    });
  }
}

/** The group a tab joins when the caller names none: the first one in the grid. */
function mainGridGroup(api: DockviewApi): DockviewGroupPanel | undefined {
  return api.groups.find((group) => group.api.location.type === "grid");
}

/**
 * Resolve a placement's `referenceGroup`: a group id, or the id of a tool open in that
 * group (agents know tools, not dockview's generated group ids). An unknown value is an
 * error — falling back would put the tab somewhere the caller did not ask for.
 */
function requireGroup(api: DockviewApi, referenceGroup: string): DockviewGroupPanel {
  const group =
    api.groups.find((candidate) => candidate.id === referenceGroup) ??
    api.getPanel(referenceGroup)?.group;
  if (!group) {
    throw new Error(
      `unknown referenceGroup: ${referenceGroup} (a group id from get_state.workbench.groups, or an open tool id)`,
    );
  }
  return group;
}

/** The Workbench's groups, for `get_state`: the ids `open_tool.position` accepts. */
export function workbenchGroups() {
  const api = dockApi();
  if (!api) return [];
  return api.groups.map((group) => ({
    id: group.id,
    tools: group.panels
      .map((panel) => panel.id)
      .filter((id) => !isCompareId(id) && !isSystemPanel(id)),
    activeTool:
      group.activePanel &&
      !isCompareId(group.activePanel.id) &&
      !isSystemPanel(group.activePanel.id)
        ? group.activePanel.id
        : null,
  }));
}

/** Whether the synth editor is open anywhere: a Workbench tab, or its popout window. */
export function synthEditorOpen(): boolean {
  return openTools().includes("synth") || poppedViews().includes("synth");
}

/** The open Workbench tab ids, in dockview order: tools and (separately) compare views. */
export function syncOpenTools(api: DockviewApi) {
  setOpenTools(
    api.panels
      .filter(
        (panel) => !isCompareId(panel.id) && !isSystemPanel(panel.id) && !isTablePanel(panel.id),
      )
      .map((panel) => panel.id as ToolId),
  );
  setOpenCompareIds(api.panels.filter((panel) => isCompareId(panel.id)).map((panel) => panel.id));
}

/** Open (or focus) a subsystem's tab, creating its store from the owning node. */
export function openSystem(scope: SubsystemScope): void {
  const api = dockApi();
  const existing = api?.getPanel(scope);
  if (existing) {
    existing.api.setActive();
    return;
  }
  // A popped-out subsystem lives in its own window: raise that window instead of
  // opening a duplicate tab here (like `openTool` does for a tool). With no Workbench
  // (a graph popout), show the subsystem in a window of its own.
  void invoke<boolean>("focus_popout", { view: scope })
    .catch(() => false)
    .then((raised) => {
      if (raised) return;
      const current = dockApi();
      if (!current) {
        void popoutView(scope);
        return;
      }
      ensureSystem(scope);
      addToMainGrid(current, scope, systemTitle(scope));
    });
}

/** Keep an open subsystem tab's title in step with a renamed node. */
export function refreshSystemTitle(scope: SubsystemScope): void {
  dockApi()?.getPanel(scope)?.api.setTitle(systemTitle(scope));
}

/** Close the subsystem tabs of `nodes` just deleted from `parent`. */
export function closeSystemsUnder(parent: GraphScope, nodes: Iterable<string>): void {
  const api = dockApi();
  for (const node of nodes) {
    api?.getPanel(systemScope(parent, node))?.api.close();
  }
}

/** Whether a panel id is a table tab (`table:<parent>/<node>`). */
export function isTablePanel(id: string): boolean {
  return parseTableScope(id) != null;
}

/** Open (or focus) a table node's rows in their own tab. */
export function openTable(scope: TableScope): void {
  const api = dockApi();
  if (!api) return;
  const existing = api.getPanel(scope);
  if (existing) {
    existing.api.setActive();
    return;
  }
  addToMainGrid(api, scope, tableTitle(scope));
}

/** A table tab's title: the node kind and its row count (`Sequence · 6 rows`). */
function tableTitle(scope: TableScope): string {
  const ref = parseTableScope(scope);
  if (!ref || !hasGraph(ref.parent)) return "Table";
  const node = graphFor(ref.parent).nodes.find((current) => current.id === ref.node);
  if (!node) return "Table";
  const label = nodeKind(node.data.kind)?.label ?? node.data.kind;
  const rows = rowCount(node.data.kind, rowsOf(node.data.kind, node.data.table));
  return `${label} · ${rows} row${rows === 1 ? "" : "s"}`;
}

/** Close the table tabs of `nodes` just deleted from `parent`. */
export function closeTablesUnder(parent: GraphScope, nodes: Iterable<string>): void {
  const api = dockApi();
  for (const node of nodes) {
    api?.getPanel(tableScope(parent, node))?.api.close();
  }
}

/**
 * Replace a parent graph's subsystems: close every open nested tab and drop its store,
 * so a tab left mounted can never edit an orphan. Callers then `loadGraph`/`loadSpec`
 * (a project restore re-opens the saved tabs from the layout).
 */
export function resetSystems(parent: GraphScope): void {
  const api = dockApi();
  for (const scope of systemsUnder(parent)) {
    api?.getPanel(scope)?.api.close();
    dropSystem(scope);
  }
}

/**
 * Snapshot the Workbench (dockview) layout for the project file, or `null`.
 *
 * **Compare panels are stripped here**, so every consumer of the layout — the saved
 * project, the undo history and the dirty signature — sees the project as if no
 * comparison were open (M25, ADR-24). This is the one place that enforces it.
 */
export function layoutJson(): SerializedDockview | null {
  return sanitizeLayout(dockApi()?.toJSON() ?? null, isCompareId);
}

/** Restore the Workbench layout from a saved project (`null` clears it). */
export function restoreLayout(layout: unknown) {
  const api = dockApi();
  if (!api) return;
  try {
    if (layout && typeof layout === "object") api.fromJSON(layout as SerializedDockview);
    else api.clear();
  } catch (err) {
    console.error("could not restore the workbench layout", err);
    api.clear();
  }
  syncOpenTools(api);
}

/** Close every Workbench tab (New Project). */
export function closeAllTools() {
  const api = dockApi();
  if (!api) return;
  api.clear();
  setOpenTools([]);
  setOpenCompareIds([]);
}
