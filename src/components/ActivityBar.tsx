import { For, Show } from "solid-js";
import Icon from "./Icon";
import Tooltip from "./Tooltip";
import { SECTION_ICONS } from "../lib/icons";
import { ANALYZER_SECTIONS } from "../state/analyzer";
import {
  activeTab,
  isAnalyzerTab,
  selectTab,
  sidebarOpen,
  type ActivityTab,
} from "../state/activityBar";
import { sectionMatchCounts } from "../state/sidebarSearch";

/**
 * Activity bar (fixed region, VSCode-style, on the far left): one tab per analyzer
 * section plus the **Graphs** tab, and a bottom-pinned group holding the two source
 * rails — **Sources** and **Export**. Selecting a tab makes the Sidebar show that
 * tab's content; selecting the tab already showing it **collapses** the rail, handing
 * its width to the Workbench. A small dot marks a section that holds **search matches**
 * while the rail shows another one (the search box lives only in the rail, and only for
 * analyzer sections).
 */
export default function ActivityBar() {
  /**
   * The number of matches the user cannot see: a section holding hits for the current
   * query that the rail is not showing (another tab is selected, or it is collapsed).
   * The utility tabs hold no analyzers, so they never carry the dot.
   */
  const hiddenMatches = (tab: ActivityTab): number => {
    if (!isAnalyzerTab(tab)) return 0;
    const count = sectionMatchCounts()[tab] ?? 0;
    return sidebarOpen() && activeTab() === tab ? 0 : count;
  };

  const isActive = (tab: ActivityTab) => sidebarOpen() && activeTab() === tab;

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
                classList={{ "activitybar-item-active": isActive(section.id) }}
                aria-label={
                  hiddenMatches(section.id) > 0
                    ? `${section.title} — ${hiddenMatches(section.id)} matching`
                    : section.title
                }
                aria-pressed={isActive(section.id)}
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
            classList={{ "activitybar-item-active": isActive("graph") }}
            aria-label="Graphs"
            aria-pressed={isActive("graph")}
            onClick={() => selectTab("graph")}
          >
            <Icon name="diagram-project" />
          </button>
        </Tooltip>
      </div>

      {/* Pinned to the bottom: Sources above Export (Export is closest to the edge). */}
      <div class="activitybar-group activitybar-group-bottom">
        <Tooltip label="Sources" placement="right">
          <button
            type="button"
            class="activitybar-item"
            data-testid="activity.tab.sources"
            classList={{ "activitybar-item-active": isActive("sources") }}
            aria-label="Sources"
            aria-pressed={isActive("sources")}
            onClick={() => selectTab("sources")}
          >
            <Icon name="file-import" />
          </button>
        </Tooltip>
        <Tooltip label="Export" placement="right">
          <button
            type="button"
            class="activitybar-item"
            data-testid="activity.tab.export"
            classList={{ "activitybar-item-active": isActive("export") }}
            aria-label="Export"
            aria-pressed={isActive("export")}
            onClick={() => selectTab("export")}
          >
            <Icon name="file-export" />
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
