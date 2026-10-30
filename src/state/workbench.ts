import { createSignal } from "solid-js";
import { invoke } from "../lib/ipc";
import { sanitizeLayout } from "../lib/dockviewLayout";
import type { DockviewApi, SerializedDockview } from "dockview";
import { ANALYZERS } from "./analyzer/defs";
import { isAnalyzerId } from "./analyzer/lookup";
import type { AnalyzerId } from "./analyzer/types";
import { isCompareId } from "./compare/id";

/**
 * Workbench tab registry.
 *
 * The Workbench (`dockview`) is the only tabbed area. Its tabs are the **graph
 * editors** (filter / synth) plus the **analyzer tools** (M4+). This module lets
 * the Sidebar (a sibling region) open and focus a tab through the shared dockview
 * API.
 */

export type ToolId = "filter" | "synth" | AnalyzerId;

export type ToolGroup = "graph" | "analyzer";

export interface ToolDef {
  id: ToolId;
  title: string;
  description: string;
  group: ToolGroup;
}

export const TOOLS: ToolDef[] = [
  {
    id: "filter",
    title: "Filter graph",
    description: "Shape the signal before preview and analysis",
    group: "graph",
  },
  {
    id: "synth",
    title: "Synth graph",
    description: "Build a fundsp synth and render it to the timeline",
    group: "graph",
  },
  ...ANALYZERS.map((analyzer): ToolDef => ({
    id: analyzer.id,
    title: analyzer.title,
    description: analyzer.description,
    group: "analyzer",
  })),
];

export function toolsInGroup(group: ToolGroup): ToolDef[] {
  return TOOLS.filter((tool) => tool.group === group);
}

export function toolById(id: ToolId): ToolDef {
  const tool = TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error(`unknown tool: ${id}`);
  return tool;
}

export const [dockApi, setDockApi] = createSignal<DockviewApi | null>(null);
export const [openTools, setOpenTools] = createSignal<ToolId[]>([]);

/** The focused Workbench tool id, or `null` when nothing (or a compare view) is focused. */
export function focusedTool(): ToolId | null {
  const id = dockApi()?.activePanel?.id;
  return id && !isCompareId(id) ? (id as ToolId) : null;
}

/** The focused **analyzer** tab, or `null` (a graph tab, or nothing focused). */
export function focusedAnalyzer(): AnalyzerId | null {
  const tool = focusedTool();
  return tool && isAnalyzerId(tool) ? tool : null;
}

/** Open a tool's tab, or focus it if it is already open (no duplicate tabs). */
export async function openTool(id: ToolId) {
  const api = dockApi();
  if (!api) return;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  // A popped-out tool lives in its own window: selecting it must raise that window
  // instead of opening a duplicate tab here (no duplicate analyzer tabs).
  const raised = await invoke<boolean>("focus_popout", { toolId: id }).catch(() => false);
  if (raised) return;
  // New tools always open in the **main** window, even when a popout is focused.
  addToMainGrid(api, id, toolById(id).title);
}

/** Add a tool to the main window's grid — never into a popped-out group. */
function addToMainGrid(api: DockviewApi, id: ToolId, title: string) {
  const grid = api.groups.find((group) => group.api.location.type === "grid");
  if (grid) {
    api.addPanel({
      id,
      component: id,
      title,
      position: { referenceGroup: grid, direction: "within" },
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

/**
 * Pop a tool out into its own window (M7).
 *
 * Only Tauri/wry manage windows — the UI just renders data — so this asks the core
 * to open a native window that shows the single tool, then removes the tab from
 * the main grid. The popout window's label is aliased to this window's project
 * state, so it analyses the same source.
 */
export async function popoutTool(id: ToolId) {
  try {
    await invoke("open_popout_window", { toolId: id });
    dockApi()?.getPanel(id)?.api.close();
  } catch (err) {
    console.error("could not pop out tool", err);
  }
}

/** The open Workbench **tool** tab ids, in dockview order (compare views excluded). */
export function syncOpenTools(api: DockviewApi) {
  setOpenTools(
    api.panels.filter((panel) => !isCompareId(panel.id)).map((panel) => panel.id as ToolId),
  );
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
}
