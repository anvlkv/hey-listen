import { For } from "solid-js";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { SECTION_ICONS } from "../lib/icons";
import { ANALYZER_SECTIONS } from "../state/analyzer";
import { activeTab, setActiveTab, type ActivityTab } from "../state/activityBar";

/**
 * Activity bar (fixed region, VSCode-style, on the far left): one tab per analyzer
 * section plus a final **Graphs** tab. Selecting a tab makes the Sidebar show that
 * tab's cards. See `docs/ui-layout.md`.
 */
export default function ActivityBar() {
  const select = (tab: ActivityTab) => setActiveTab(tab);

  return (
    <nav class="app-activitybar" data-testid="region.activitybar" aria-label="Tool categories">
      <div class="activitybar-group">
        <For each={ANALYZER_SECTIONS}>
          {(section) => (
            <Tooltip label={section.title} placement="right">
              <button
                type="button"
                class="activitybar-item"
                data-testid={`activity.tab.${section.id}`}
                classList={{ "activitybar-item-active": activeTab() === section.id }}
                aria-label={section.title}
                aria-pressed={activeTab() === section.id}
                onClick={() => select(section.id)}
              >
                <Icon name={SECTION_ICONS[section.id]} />
              </button>
            </Tooltip>
          )}
        </For>

        <Tooltip label="Graphs" placement="right">
          <button
            type="button"
            class="activitybar-item"
            data-testid="activity.tab.graph"
            classList={{ "activitybar-item-active": activeTab() === "graph" }}
            aria-label="Graphs"
            aria-pressed={activeTab() === "graph"}
            onClick={() => select("graph")}
          >
            <Icon name="diagram-project" />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
