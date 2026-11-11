import { createSignal } from "solid-js";
import type { AnalyzerSection } from "./analyzer/types";

/**
 * A tab in the vertical activity bar (VSCode-style, far left): an analyzer section,
 * or the graph editors. Exactly one tab is selected, and the Sidebar shows that tab's
 * cards — the activity bar is a **tab switcher**, not a filter.
 */
export type ActivityTab = AnalyzerSection | "graph";

/** The selected activity-bar tab. Defaults to the first analyzer section (`time`). */
const [activeTab, setActiveTab] = createSignal<ActivityTab>("time");

export { activeTab };

/**
 * Whether the Sidebar rail is shown. Collapsing it hands its width (and the splitter) to
 * the Workbench. This is window chrome, not project data, so it is not persisted — a
 * fresh window opens with the rail showing.
 */
export const [sidebarOpen, setSidebarOpen] = createSignal(true);

/**
 * Select an activity-bar tab. Selecting the tab whose cards are already showing
 * **collapses** the rail (a second click gives the Workbench the room); any other
 * selection — including the same tab while the rail is collapsed — shows it.
 */
export function selectTab(tab: ActivityTab): void {
  if (tab === activeTab() && sidebarOpen()) {
    setSidebarOpen(false);
    return;
  }
  setActiveTab(tab);
  setSidebarOpen(true);
}
