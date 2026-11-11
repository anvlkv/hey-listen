import { For, Show } from "solid-js";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { SECTION_ICONS } from "../lib/icons";
import { ANALYZER_SECTIONS } from "../state/analyzer";
import { activeTab, selectTab, sidebarOpen, type ActivityTab } from "../state/activityBar";
import { sectionMatchCounts } from "../state/sidebarSearch";

/**
 * Activity bar (fixed region, VSCode-style, on the far left): one tab per analyzer
 * section plus a final **Graphs** tab. Selecting a tab makes the Sidebar show that
 * tab's cards; selecting the tab that is already showing them **collapses** the rail,
 * handing its width to the Workbench. A small dot marks a section that holds **search
 * matches** while the rail shows another one (the search box lives only in the rail).
 * See `docs/ui-layout.md`.
 */
export default function ActivityBar() {
  /**
   * The number of matches the user cannot see: a section holding hits for the current
   * query that the rail is not showing (another tab is selected, or it is collapsed).
   * `graph` holds no analyzers, so it never carries the dot.
   */
  const hiddenMatches = (tab: ActivityTab): number => {
    if (tab === "graph") return 0;
    const count = sectionMatchCounts()[tab] ?? 0;
    return sidebarOpen() && activeTab() === tab ? 0 : count;
  };

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
                classList={{
                  "activitybar-item-active": sidebarOpen() && activeTab() === section.id,
                }}
                aria-label={
                  hiddenMatches(section.id) > 0
                    ? `${section.title} — ${hiddenMatches(section.id)} matching`
                    : section.title
                }
                aria-pressed={sidebarOpen() && activeTab() === section.id}
                onClick={() => selectTab(section.id)}
              >
                <Icon name={SECTION_ICONS[section.id]} />
                <Show when={hiddenMatches(section.id) > 0}>
                  <span
                    class="activitybar-match"
                    data-testid={`activity.matches.${section.id}`}
                    aria-hidden="true"
                  />
                </Show>
              </button>
            </Tooltip>
          )}
        </For>

        <Tooltip label="Graphs" placement="right">
          <button
            type="button"
            class="activitybar-item"
            data-testid="activity.tab.graph"
            classList={{ "activitybar-item-active": sidebarOpen() && activeTab() === "graph" }}
            aria-label="Graphs"
            aria-pressed={sidebarOpen() && activeTab() === "graph"}
            onClick={() => selectTab("graph")}
          >
            <Icon name="diagram-project" />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
