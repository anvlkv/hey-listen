import { ANALYZERS } from "./analyzer/defs";
import type { ToolId as GeneratedToolId } from "../bindings/ToolId";

/**
 * The Workbench **tools** — the graph editors and every analyzer — as one table.
 *
 * Kept apart from `state/workbench.ts` (the dockview tab registry) so the popout and
 * view helpers can name a tool without depending on the Workbench, and so the tab
 * registry stays a focused module.
 */

/** A Workbench tab id, generated from the Rust `ToolId` (M15.B / ADR-28). */
export type ToolId = GeneratedToolId;

export type ToolDef = {
  id: ToolId;
  title: string;
  description: string;
};

export const TOOLS: ToolDef[] = [
  {
    id: "filter",
    title: "Filter graph",
    description: "Shape the signal before preview and analysis",
  },
  {
    id: "synth",
    title: "Synth graph",
    description: "Build a fundsp synth and render it to the timeline",
  },
  ...ANALYZERS.map((analyzer): ToolDef => ({
    id: analyzer.id,
    title: analyzer.title,
    description: analyzer.description,
  })),
];

export function toolById(id: ToolId): ToolDef {
  const tool = TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error(`unknown tool: ${id}`);
  return tool;
}
