import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import { GRAPH_ICONS, VIEW_ICONS, type IconName } from "../lib/icons";
import { openTool, openTools, toolsInGroup, type ToolDef } from "../state/workbench";
import {
  ANALYZER_SECTIONS,
  analyzersInSection,
  matchesQuery,
  type AnalyzerDef,
} from "../state/analyzer";

/**
 * Sidebar (fixed region): the tool picker. A **search box** at the top filters the
 * analyzer list by title, description, and keywords; the analyzers come **first**,
 * grouped by domain, then the two graph editors. Clicking an entry opens (or
 * focuses) its tab in the Workbench. See `docs/ui-layout.md` and
 * `docs/analysis-tools.md`.
 *
 * Each row carries the tool's **chart-type** icon in its bottom-right corner
 * (`lib/icons.ts` → `VIEW_ICONS`, so two tools of the same chart type share an icon)
 * and its hint as a [`Tooltip`](./Tooltip.tsx). Section titles and subtitles are plain
 * text.
 */

/** A sidebar entry: the workbench tool, its chart-type icon, and the hover copy. */
type SidebarTool = ToolDef & { tooltip: string; icon: IconName };

// Analyzers carry an `about` string (when/how to use); surface it on hover.
const toTool = (def: AnalyzerDef): SidebarTool => ({
  id: def.id,
  title: def.title,
  description: def.description,
  group: "analyzer",
  tooltip: def.about,
  icon: VIEW_ICONS[def.view.kind],
});

export default function Sidebar(props: { style?: JSX.CSSProperties }) {
  const [query, setQuery] = createSignal("");

  const matches = (def: AnalyzerDef) => matchesQuery(def, query());

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

  const anyMatches = createMemo(() =>
    ANALYZER_SECTIONS.some((section) =>
      analyzersInSection(section.id).some(matches),
    ),
  );

  return (
    <aside class="app-sidebar" data-testid="region.sidebar" style={props.style}>
      <div class="sidebar-search-wrap">
        <Icon name="magnifying-glass" class="sidebar-search-icon" />
        <input
          class="sidebar-search"
          data-testid="sidebar.search"
          type="search"
          placeholder="Search analyzers…"
          aria-label="Search analyzers"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      <ScrollArea class="sidebar-scroll">
      <div class="sidebar-section-title">Analyzers</div>
      <Show
        when={anyMatches()}
        fallback={<div class="sidebar-empty" data-testid="sidebar.empty">No analyzers match “{query()}”.</div>}
      >
        <For each={ANALYZER_SECTIONS}>
          {(section) => {
            const list = createMemo(() =>
              analyzersInSection(section.id).filter(matches).map(toTool),
            );
            return (
              <Show when={list().length > 0}>
                <div class="sidebar-subtitle">{section.title}</div>
                <Tools tools={list()} />
              </Show>
            );
          }}
        </For>
      </Show>

      <div class="sidebar-section-title sidebar-section-gap">Graphs</div>
      <Tools
        tools={toolsInGroup("graph").map((tool) => ({
          ...tool,
          tooltip: tool.description,
          icon: GRAPH_ICONS[tool.id as "filter" | "synth"],
        }))}
      />
      </ScrollArea>
    </aside>
  );
}
