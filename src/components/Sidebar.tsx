import { For } from "solid-js";
import { openTool, openTools, TOOLS } from "../state/workbench";

/**
 * Sidebar (fixed region): the tool picker. Clicking a tool opens (or focuses) its
 * tab in the Workbench. Analyzer tools join the graph editors in M4/M5
 * (see `docs/analysis-tools.md`).
 */
export default function Sidebar() {
  return (
    <aside class="app-sidebar">
      <div class="sidebar-section-title">Graphs</div>
      <div class="sidebar-tools">
        <For each={TOOLS}>
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
      <div class="sidebar-empty">Analyzers arrive in M4.</div>
    </aside>
  );
}
