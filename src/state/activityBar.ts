import { createSignal } from "solid-js";
import type { AnalyzerSection } from "./analyzer/types";

/**
 * A tab in the vertical activity bar (VSCode-style, far left): an analyzer section,
 * or the graph editors. Exactly one tab is active, and the Sidebar shows that tab's
 * cards — the activity bar is a **tab switcher**, not a filter.
 */
export type ActivityTab = AnalyzerSection | "graph";

/** The active activity-bar tab. Defaults to the first analyzer section (`time`). */
export const [activeTab, setActiveTab] = createSignal<ActivityTab>("time");
