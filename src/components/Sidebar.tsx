import { createMemo, For, Show, type JSX } from "solid-js";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import { GRAPH_ICONS, VIEW_ICONS, type IconName } from "../lib/icons";
import { markdownSummary } from "../lib/markdown";
import { openTool, openTools, toolById, type ToolDef } from "../state/workbench";
import {
  ANALYZER_SECTIONS,
  analyzersInSection,
  matchesQuery,
  type AnalyzerDef,
} from "../state/analyzer";
import { activeTab } from "../state/activityBar";
import { analyzerQuery, setAnalyzerQuery } from "../state/sidebarSearch";

/**
 * Sidebar (fixed region): the tool picker. It shows the cards of the activity bar's
 * **active tab** — one analyzer section, or the two graph editors. A **search box**
 * (hidden on the Graphs tab) filters the active section's analyzers by title,
 * description, and keywords; the query lives in [`sidebarSearch`](../state/sidebarSearch.ts)
 * so the Activity bar can mark the sections it matches while another one is showing.
 * Clicking an entry opens (or focuses) its Workbench tab.
 * See `docs/ui-layout.md` and `docs/analysis-tools.md`.
 *
 * Each analyzer row carries the tool's **chart-type** icon in its bottom-right corner
 * (`lib/icons.ts` → `VIEW_ICONS`); the graph rows carry their editor icons
 * (`GRAPH_ICONS`). Hover copy is a [`Tooltip`](./Tooltip.tsx).
 */

/** A sidebar entry: the workbench tool, its icon, and the hover copy. */
type SidebarTool = ToolDef & { tooltip: string; icon: IconName };

// Analyzers carry markdown `about` copy (when/how to use); surface a plain-text
// preview on hover — the full, formatted version lives in the tab's About popover.
const toTool = (def: AnalyzerDef): SidebarTool => ({
  id: def.id,
  title: def.title,
  description: def.description,
  tooltip: markdownSummary(def.about, 240),
  icon: VIEW_ICONS[def.view.kind],
});

/** The two graph editors as Sidebar cards (the activity bar's `graph` tab). */
const graphTools = (): SidebarTool[] =>
  (["filter", "synth"] as const).map((id) => {
    const tool = toolById(id);
    return { ...tool, tooltip: tool.description, icon: GRAPH_ICONS[id] };
  });

export default function Sidebar(props: { style?: JSX.CSSProperties }) {
  const matches = (def: AnalyzerDef) => matchesQuery(def, analyzerQuery());

  const isGraph = () => activeTab() === "graph";
  const section = () => ANALYZER_SECTIONS.find((item) => item.id === activeTab());

  /** The active section's analyzer cards (empty on the Graphs tab). */
  const sectionTools = createMemo(() => {
    const active = activeTab();
    if (active === "graph") return [];
    const def = ANALYZER_SECTIONS.find((item) => item.id === active);
    return def ? analyzersInSection(def.id).filter(matches).map(toTool) : [];
  });

  const Tools = (props: { tools: SidebarTool[] }) => (
    <div class="sidebar-tools">
      <For each={props.tools}>
        {(tool) => (
          <Tooltip label={tool.tooltip} placement="right">
            <button
              type="button"
              class="sidebar-tool"
              data-testid={`sidebar.tool.${tool.id}`}
              classList={{ "sidebar-tool-open": openTools().includes(tool.id) }}
              onClick={() => openTool(tool.id)}
            >
              <span class="sidebar-tool-name">{tool.title}</span>
              <span class="sidebar-tool-desc">{tool.description}</span>
              <Icon name={tool.icon} class="sidebar-tool-icon" />
            </button>
          </Tooltip>
        )}
      </For>
    </div>
  );

  return (
    <aside class="app-sidebar" data-testid="region.sidebar" style={props.style}>
      <Show when={!isGraph()}>
        <div class="sidebar-search-wrap">
          <Icon name="magnifying-glass" class="sidebar-search-icon" />
          <input
            class="sidebar-search"
            data-testid="sidebar.search"
            type="search"
            placeholder="Search analyzers…"
            aria-label="Search analyzers"
            value={analyzerQuery()}
            onInput={(event) => setAnalyzerQuery(event.currentTarget.value)}
          />
        </div>
      </Show>

      <ScrollArea class="sidebar-scroll">
        <div class="sidebar-section-title">{isGraph() ? "Graphs" : "Analyzers"}</div>
        <Show
          when={isGraph()}
          fallback={
            <Show
              when={sectionTools().length > 0}
              fallback={
                <div class="sidebar-empty" data-testid="sidebar.empty">
                  No analyzers match “{analyzerQuery()}”.
                </div>
              }
            >
              <div class="sidebar-subtitle">{section()?.title}</div>
              <Tools tools={sectionTools()} />
            </Show>
          }
        >
          <Tools tools={graphTools()} />
        </Show>
      </ScrollArea>
    </aside>
  );
}
