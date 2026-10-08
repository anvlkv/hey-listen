import { createSignal } from "solid-js";
import type { DockviewApi } from "dockview";
import { ANALYZERS, type AnalyzerId } from "./analyzer";

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
  ...ANALYZERS.map(
    (analyzer): ToolDef => ({
      id: analyzer.id,
      title: analyzer.title,
      description: analyzer.description,
      group: "analyzer",
    }),
  ),
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

/** Open a tool's tab, or focus it if it is already open (no duplicate tabs). */
export function openTool(id: ToolId) {
  const api = dockApi();
  if (!api) return;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel({ id, component: id, title: toolById(id).title });
}
