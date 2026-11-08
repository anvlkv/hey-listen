import { For } from "solid-js";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { GRAPH_ICONS, SECTION_ICONS } from "../lib/icons";
import { ANALYZER_SECTIONS } from "../state/analyzer";
import { activeSection, setActiveSection } from "../state/activityBar";
import { openTool } from "../state/workbench";

/**
 * Activity bar (fixed region, VSCode-style, on the far left): one icon per analyzer
 * category, plus the two graph editors as their own entries. Clicking a category
 * filters the Sidebar to that section (clicking it again returns to "everything");
 * clicking a graph entry opens its Workbench tab directly. See `docs/ui-layout.md`.
 */
export default function ActivityBar() {
  const toggleSection = (id: (typeof ANALYZER_SECTIONS)[number]["id"]) =>
    setActiveSection(activeSection() === id ? null : id);

  return (
    <nav class="app-activitybar" data-testid="region.activitybar" aria-label="Tool categories">
      <div class="activitybar-group">
        <For each={ANALYZER_SECTIONS}>
          {(section) => (
            <Tooltip label={section.title} placement="right">
              <button
                type="button"
                class="activitybar-item"
                data-testid={`activity.section.${section.id}`}
                classList={{ "activitybar-item-active": activeSection() === section.id }}
                aria-label={section.title}
                aria-pressed={activeSection() === section.id}
                onClick={() => toggleSection(section.id)}
              >
                <Icon name={SECTION_ICONS[section.id]} />
              </button>
            </Tooltip>
          )}
        </For>
      </div>

      <div class="activitybar-group activitybar-group-bottom">
        <Tooltip label="Filter graph" placement="right">
          <button
            type="button"
            class="activitybar-item"
            data-testid="activity.filter"
            aria-label="Filter graph"
            onClick={() => openTool("filter")}
          >
            <Icon name={GRAPH_ICONS.filter} />
          </button>
        </Tooltip>
        <Tooltip label="Synth graph" placement="right">
          <button
            type="button"
            class="activitybar-item"
            data-testid="activity.synth"
            aria-label="Synth graph"
            onClick={() => openTool("synth")}
          >
            <Icon name={GRAPH_ICONS.synth} />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
