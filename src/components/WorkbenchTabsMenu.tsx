import { Popover as KPopover } from "@kobalte/core/popover";
import type { DockviewApi, DockviewGroupPanel } from "dockview";
import { createSignal, For, onCleanup, Show, untrack } from "solid-js";
import Icon from "./Icon";
import { createPopupMount } from "../lib/popupMount";

/**
 * A group header's **Tabs (N)** menu: the app's own replacement for dockview's
 * built-in overflow dropdown, which truncates long titles and has no search.
 *
 * It lists every tab of its dockview group (in tab order) with the **full, wrapping**
 * title, filters them as the user types, and activates one on click. The panel list is
 * re-read on every dockview event that can reorder or retitle a tab, so a drag between
 * groups is reflected immediately.
 */
export default function WorkbenchTabsMenu(props: { group: DockviewGroupPanel; api: DockviewApi }) {
  // A header's group and the api never change for the lifetime of this renderer, so
  // read them once instead of tracking two props for every list refresh.
  const group = untrack(() => props.group);
  const api = untrack(() => props.api);
  const portal = createPopupMount();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [tabs, setTabs] = createSignal<{ id: string; title: string }[]>([]);
  const [activeId, setActiveId] = createSignal<string | undefined>(undefined);

  const refresh = () => {
    setTabs(group.panels.map((panel) => ({ id: panel.id, title: panel.title ?? panel.id })));
    setActiveId(group.activePanel?.id);
  };

  // A tab can move between groups (pointer drag), be retitled (a compare tab), or
  // appear/disappear, so every one of these events re-reads `group.panels`.
  const subscriptions = [
    group.api.onDidActivePanelChange(refresh),
    api.onDidAddPanel(refresh),
    api.onDidRemovePanel(refresh),
    api.onDidLayoutChange(refresh),
  ];
  onCleanup(() => subscriptions.forEach((subscription) => subscription.dispose()));
  refresh();

  const matches = () => {
    const needle = query().trim().toLowerCase();
    if (!needle) return tabs();
    return tabs().filter((tab) => tab.title.toLowerCase().includes(needle));
  };

  /** Dismissing the menu (a selection, Escape, an outside click) always clears the search. */
  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const activate = (id: string) => {
    api.getPanel(id)?.api.setActive();
    close();
  };

  return (
    <KPopover
      open={open()}
      placement="bottom-end"
      gutter={6}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          close();
          return;
        }
        setOpen(true);
        // Read the current group once more: a title can change without a layout event.
        refresh();
        portal.refresh();
      }}
    >
      <KPopover.Trigger
        ref={portal.ref}
        class="pop-trigger tabs-menu-trigger"
        aria-label={`Workbench tabs (${tabs().length})`}
        data-testid="workbench.tabsMenu"
      >
        <Icon name="table-list" />
        <span>Tabs ({tabs().length})</span>
      </KPopover.Trigger>
      <KPopover.Portal mount={portal.mount()}>
        <KPopover.Content class="pop-panel pop-panel-tabs">
          <input
            class="tabs-menu-search"
            type="text"
            placeholder="Search tabs…"
            aria-label="Search tabs"
            data-testid="workbench.tabsMenu.search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <div class="tabs-menu-list">
            <For each={matches()}>
              {(tab) => (
                <button
                  type="button"
                  class="tabs-menu-item"
                  classList={{ "tabs-menu-item-active": tab.id === activeId() }}
                  title={tab.title}
                  aria-current={tab.id === activeId() ? "page" : undefined}
                  data-testid={`workbench.tabsMenu.${tab.id}`}
                  onClick={() => activate(tab.id)}
                >
                  {tab.title}
                </button>
              )}
            </For>
            <Show when={matches().length === 0}>
              <div class="tabs-menu-empty">No tabs match “{query()}”.</div>
            </Show>
          </div>
        </KPopover.Content>
      </KPopover.Portal>
    </KPopover>
  );
}
