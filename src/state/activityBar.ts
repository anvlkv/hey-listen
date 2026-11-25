import { createSignal } from "solid-js";
import type { AnalyzerSection } from "./analyzer/types";

/**
 * A tab in the vertical activity bar (VSCode-style, far left): an analyzer section,
 * the graph editors, or one of the two **source rails** (`sources` / `export`) pinned
 * at the bottom. Exactly one tab is selected, and the Sidebar shows that tab's content
 * — the activity bar is a **tab switcher**, not a filter.
 *
 * Use the guards below to narrow the union; they are the one place it is interpreted.
 */
export type ActivityTab = AnalyzerSection | "graph" | "sources" | "export";

/** The tabs that are not analyzer sections. */
const UTILITY_TABS: readonly ActivityTab[] = ["graph", "sources", "export"];

/** Whether `tab` is an analyzer section (the only tabs the search box filters). */
export function isAnalyzerTab(tab: ActivityTab): tab is AnalyzerSection {
  return !UTILITY_TABS.includes(tab);
}

/** Whether `tab` shows the graph editors. */
export function isGraphTab(tab: ActivityTab): tab is "graph" {
  return tab === "graph";
}

/** Whether `tab` shows the Sources rail. */
export function isSourcesTab(tab: ActivityTab): tab is "sources" {
  return tab === "sources";
}

/**
 * The selected activity-bar tab. Defaults to **Sources**, so a fresh window opens the
 * rail on the source picker (the Timeline sits below with its empty-state overlay).
 */
const [activeTab, setActiveTab] = createSignal<ActivityTab>("sources");

export { activeTab };

/**
 * Whether the Sidebar rail is shown. Collapsing it hands its width (and the splitter) to
 * the Workbench. This is window chrome, not project data, so it is not persisted — a
 * fresh window opens with the rail showing.
 */
export const [sidebarOpen, setSidebarOpen] = createSignal(true);

/**
 * While true the rail is pinned to **Sources** and cannot collapse — a live recording's
 * Stop lives there. Set by the capture session for the duration of a recording.
 */
export const [sidebarLocked, setSidebarLocked] = createSignal(false);

/**
 * Select an activity-bar tab. Selecting the tab whose content is already showing
 * **collapses** the rail (a second click gives the Workbench the room); any other
 * selection — including the same tab while the rail is collapsed — shows it. While
 * recording (`sidebarLocked`) the rail stays on Sources.
 */
export function selectTab(tab: ActivityTab): void {
  if (sidebarLocked()) {
    setActiveTab("sources");
    setSidebarOpen(true);
    return;
  }
  if (tab === activeTab() && sidebarOpen()) {
    setSidebarOpen(false);
    return;
  }
  setActiveTab(tab);
  setSidebarOpen(true);
}

/**
 * Select a tab **without** collapsing: the Timeline's *Replace* button reveals the
 * Sources rail even when it is already the active tab.
 */
export function showTab(tab: ActivityTab): void {
  setActiveTab(tab);
  setSidebarOpen(true);
}
