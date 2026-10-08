import { createMemo, createSignal, For, Show } from "solid-js";
import ScrollArea from "./ScrollArea";
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
 */

const toTool = (def: AnalyzerDef): ToolDef => ({
  id: def.id,
  title: def.title,
  description: def.description,
  group: "analyzer",
});

export default function Sidebar() {
  const [query, setQuery] = createSignal("");

  const matches = (def: AnalyzerDef) => matchesQuery(def, query());

  const Tools = (props: { tools: ToolDef[] }) => (
    <div class="sidebar-tools">
      <For each={props.tools}>
        {(tool) => (
          <button
            type="button"
            class="sidebar-tool"
            classList={{ "sidebar-tool-open": openTools().includes(tool.id) }}
            onClick={() => openTool(tool.id)}
          >
            <span class="sidebar-tool-name">{tool.title}</span>
            <span class="sidebar-tool-desc">{tool.description}</span>
          </button>
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
    <aside class="app-sidebar">
      <ScrollArea class="sidebar-scroll">
      <input
        class="sidebar-search"
        type="search"
        placeholder="Search analyzers…"
        aria-label="Search analyzers"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />

      <div class="sidebar-section-title">Analyzers</div>
      <Show
        when={anyMatches()}
        fallback={<div class="sidebar-empty">No analyzers match “{query()}”.</div>}
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
      <Tools tools={toolsInGroup("graph")} />
      </ScrollArea>
    </aside>
  );
}
