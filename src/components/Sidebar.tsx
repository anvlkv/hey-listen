import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import Icon from "./Icon";
import ScrollArea from "./ScrollArea";
import Tooltip from "./Tooltip";
import { VIEW_ICONS, type IconName } from "../lib/icons";
import { markdownSummary } from "../lib/markdown";
import { openTool, openTools, type ToolDef } from "../state/workbench";
import {
  ANALYZER_SECTIONS,
  analyzersInSection,
  matchesQuery,
  type AnalyzerDef,
} from "../state/analyzer";
import { activeSection } from "../state/activityBar";

/**
 * Sidebar (fixed region): the tool picker. A **search box** at the top filters the
 * analyzer list by title, description, and keywords; the analyzers are grouped by
 * domain. Clicking an entry opens (or focuses) its tab in the Workbench. The
 * vertical **activity bar** (far left) narrows this list to one section; the two
 * graph editors live there instead. See `docs/ui-layout.md` and
 * `docs/analysis-tools.md`.
 *
 * Each row carries the tool's **chart-type** icon in its bottom-right corner
 * (`lib/icons.ts` → `VIEW_ICONS`, so two tools of the same chart type share an icon)
 * and its hint as a [`Tooltip`](./Tooltip.tsx). Section titles and subtitles are plain
 * text.
 */

/** A sidebar entry: the workbench tool, its chart-type icon, and the hover copy. */
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

  // The activity bar narrows the list to one section; `null` (the default) shows
  // every section grouped, so the Sidebar still lists every tool until a category is
  // picked.
  const visibleSections = () => {
    const section = activeSection();
    return section ? ANALYZER_SECTIONS.filter((item) => item.id === section) : ANALYZER_SECTIONS;
  };

  const anyMatches = createMemo(() =>
    visibleSections().some((section) => analyzersInSection(section.id).some(matches)),
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
          fallback={
            <div class="sidebar-empty" data-testid="sidebar.empty">
              No analyzers match “{query()}”.
            </div>
          }
        >
          <For each={visibleSections()}>
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
      </ScrollArea>
    </aside>
  );
}
