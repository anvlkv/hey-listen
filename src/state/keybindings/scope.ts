import { focusedTool } from "../workbench";
import type { CommandScope } from "./types";

/**
 * Scope resolution for the dispatcher. Returns the **most-specific** region that
 * currently owns focus, so a
 * command declared for `annotations` / `graph` / `timeline` / `workbench` beats a
 * `global` command with the same chord.
 */

const ANNOTATIONS_REGION = '[data-testid="region.annotations"]';
const TIMELINE_CANVAS = '[data-testid="timeline.canvas"]';
const WORKBENCH_REGION = '[data-testid="region.workbench"]';

/** Whether focus sits inside (or on) the element matching `selector`. */
function focusWithin(selector: string): boolean {
  const active = document.activeElement;
  const element = active instanceof HTMLElement ? active : null;
  return element?.closest(selector) != null;
}

/** The region the keyboard is currently in, most specific first. */
export function resolveScope(): CommandScope {
  if (focusWithin(ANNOTATIONS_REGION)) return "annotations";
  const tool = focusedTool();
  if (tool === "filter" || tool === "synth") return "graph";
  if (focusWithin(TIMELINE_CANVAS)) return "timeline";
  if (focusWithin(WORKBENCH_REGION)) return "workbench";
  return "global";
}
