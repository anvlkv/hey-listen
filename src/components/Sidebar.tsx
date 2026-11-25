import { createMemo, For, Match, Show, Switch, type JSX } from "solid-js";
import Icon from "./Icon";
import MarkdownHint from "./MarkdownHint";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import AudioExportPanel from "./export/AudioExportPanel";
import SourcePanel from "./SourcePanel";
import { GRAPH_ICONS, VIEW_ICONS, type IconName } from "../lib/icons";
import { markdownSummary } from "../lib/markdown";
import { openTool, openSystem, openTools, toolById, type ToolDef } from "../state/workbench";
import { subsystems } from "../state/subsystems";
import {
  ANALYZER_SECTIONS,
  analyzersInSection,
  matchesQuery,
  type AnalyzerDef,
} from "../state/analyzer";
import { activeTab, isAnalyzerTab, isGraphTab, isSourcesTab } from "../state/activityBar";
import { analyzerQuery, setAnalyzerQuery } from "../state/sidebarSearch";

/**
 * Sidebar (fixed region): the content of the activity bar's **active tab**.
 *
 * - an analyzer section — its cards, filtered by the **search box**;
 * - the **Graphs** tab — the two graph editors plus any open subsystems;
 * - the **Sources** rail — the source picker and capture controls ([`SourcePanel`]);
 * - the **Export** rail — the audio export controls ([`AudioExportPanel`]).
 *
 * The search box is shown only for analyzer sections, the only content it filters. Each
 * analyzer row carries the tool's **chart-type** icon in its bottom-right corner
 * (`lib/icons.ts` → `VIEW_ICONS`); the graph rows carry their editor icons
 * (`GRAPH_ICONS`). Hover copy is a [`Tooltip`](./Tooltip.tsx): analyzers show a
 * **formatted**, compact markdown hint ([`MarkdownHint`](./MarkdownHint.tsx)) trimmed
 * from their About copy, the graphs their plain description.
 */

/** A sidebar entry: the workbench tool, its icon, and the hover hint. */
type SidebarTool = ToolDef & { hint: JSX.Element; icon: IconName };

/** How much copy a row's hover hint keeps, in plain characters. */
const HINT_CHARS = 280;

// Analyzers carry markdown `about` copy (what it shows, when to use it). The hint keeps
// its first paragraphs, formatted; the full copy lives in the tab's About popover.
const toTool = (def: AnalyzerDef): SidebarTool => ({
  id: def.id,
  title: def.title,
  description: def.description,
  hint: <MarkdownHint source={markdownSummary(def.about, HINT_CHARS)} />,
  icon: VIEW_ICONS[def.view.kind],
});

/** The two graph editors as Sidebar cards (the activity bar's `graph` tab). */
const graphTools = (): SidebarTool[] =>
  (["filter", "synth"] as const).map((id) => {
    const tool = toolById(id);
    return { ...tool, hint: tool.description, icon: GRAPH_ICONS[id] };
  });

/** A readable parent for a subsystem row (`filter`, `synth`, or the parent's kind). */
function parentLabel(parent: string): string {
  if (parent === "filter") return "the filter graph";
  if (parent === "synth") return "the synth graph";
  const node = parent.slice(parent.lastIndexOf("/") + 1);
  return node || "another subsystem";
}

export default function Sidebar(props: { style?: JSX.CSSProperties }) {
  const matches = (def: AnalyzerDef) => matchesQuery(def, analyzerQuery());

  const section = () => {
    const active = activeTab();
    return isAnalyzerTab(active) ? ANALYZER_SECTIONS.find((item) => item.id === active) : undefined;
  };

  /** The active analyzer section's cards (empty on every other tab). */
  const sectionTools = createMemo(() => {
    const active = activeTab();
    if (!isAnalyzerTab(active)) return [];
    return analyzersInSection(active).filter(matches).map(toTool);
  });

  const Tools = (props: { tools: SidebarTool[] }) => (
    <div class="sidebar-tools">
      <For each={props.tools}>
        {(tool) => (
          <Tooltip label={tool.hint} placement="right" contentClass="tooltip-content-wide">
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
      <Switch>
        <Match when={isSourcesTab(activeTab())}>
          <SourcePanel />
        </Match>
        <Match when={activeTab() === "export"}>
          <AudioExportPanel />
        </Match>
        <Match when={isGraphTab(activeTab()) || isAnalyzerTab(activeTab())}>
          <Show when={isAnalyzerTab(activeTab())}>
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

          <ScrollArea class="sidebar-scroll" resetKey={analyzerQuery()}>
            <div class="sidebar-section-title">
              {isGraphTab(activeTab()) ? "Graphs" : "Analyzers"}
            </div>
            <Show
              when={isGraphTab(activeTab())}
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
              <Show when={subsystems().length > 0}>
                <div class="sidebar-subtitle">Subsystems</div>
                <div class="sidebar-tools">
                  <For each={subsystems()}>
                    {(system) => (
                      <button
                        type="button"
                        class="sidebar-tool"
                        data-testid="sidebar.subsystem"
                        data-scope={system.scope}
                        onClick={() => openSystem(system.scope)}
                      >
                        <span class="sidebar-tool-name">{system.label}</span>
                        <span class="sidebar-tool-desc">
                          nested in {parentLabel(system.parent)}
                        </span>
                        <Icon name={GRAPH_ICONS.filter} class="sidebar-tool-icon" />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </ScrollArea>
        </Match>
      </Switch>
    </aside>
  );
}
