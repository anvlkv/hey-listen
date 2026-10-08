import { For } from "solid-js";
import { openTool, openTools, toolsInGroup, type ToolDef } from "../state/workbench";

/**
 * Sidebar (fixed region): the tool picker. Lists the graph editors and the
 * analyzer tools; clicking an entry opens (or focuses) its tab in the Workbench.
 * See `docs/ui-layout.md` and `docs/analysis-tools.md`.
 */
export default function Sidebar() {
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

  return (
    <aside class="app-sidebar">
      <div class="sidebar-section-title">Graphs</div>
      <Tools tools={toolsInGroup("graph")} />
      <div class="sidebar-section-title sidebar-section-gap">Analyzers</div>
      <Tools tools={toolsInGroup("analyzer")} />
    </aside>
  );
}
