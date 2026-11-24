import { DockviewComponent, themeDark, themeLight, type ContextMenuItem } from "dockview";
import "dockview/dist/styles/dockview.css";
import { createEffect, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import ToolContent from "./ToolContent";
import WorkbenchTabsMenu from "./WorkbenchTabsMenu";
import { scheduleStampTabIds, observeTabIds } from "./workbenchTabIds";
import { exportAllOpenAnalyses, exportAnalysis, exportChart } from "../lib/export";
import { isAnalyzerId } from "../state/analyzer";
import { source } from "../state/source";
import { resolvedTheme } from "../state/themes";
import {
  setDockApi,
  setLayoutRevision,
  setOpenTools,
  syncOpenTools,
  popoutView,
  isSystemPanel,
  refreshPoppedViews,
  type ToolId,
} from "../state/workbench";
import { chooseCompareReference } from "../state/compare/picker";
import { parseComparePanel } from "../state/compare/id";
import { popoutCompare, closeCompare } from "../state/compare/views";

/**
 * Workbench (fixed region): hosts the Workbench tabs, and is the **only** tabbed
 * area in the app — so `dockview` is mounted here and nowhere else.
 *
 * The tabs are the graph editors (filter / synth) and the analyzer tools. Each
 * panel's content is a Solid root rendered into the panel element and disposed when
 * dockview unmounts it (the graph state lives in `state/graph.ts` and analyzer
 * results come from the result cache, so closing a tab is safe).
 */

/** A tab-menu export has no panel to report into; log rather than swallow it. */
function reportExportError(error: unknown): void {
  console.error("export failed", error);
}

/** The watermark (no Workbench tabs open) — it guides toward the next step. */
function WatermarkHint() {
  const hasSource = () => source() != null;
  return (
    <>
      <span class="empty-state-icon" aria-hidden="true">
        {hasSource() ? "◧" : "∿"}
      </span>
      <span class="empty-state-title">{hasSource() ? "No views open" : "Start with audio"}</span>
      <span class="empty-state-hint">
        {hasSource()
          ? "Pick a graph or analyzer from the Sidebar on the left."
          : "Add a file, recording, or synth in the Source panel below, then open a graph or analyzer here."}
      </span>
    </>
  );
}

export default function Workbench() {
  // The workbench mounts dockview into the `<section>` host (an `HTMLElement`).
  let host!: HTMLElement;
  let dockview: DockviewComponent | undefined;
  /** Stops the tab-stamp observer (see `workbenchTabIds.ts`). */
  let stopObservingTabIds: (() => void) | undefined;

  /** The dockview theme matching the active [`resolvedTheme`]. */
  const dockTheme = () => (resolvedTheme() === "light" ? themeLight : themeDark);

  onMount(() => {
    dockview = new DockviewComponent(host, {
      theme: dockTheme(),
      // Tabs are dragged by pointer, not HTML5 DnD: the WebView does not drive
      // HTML5 drag reliably, which left split/join (edge drops) inoperative.
      dndStrategy: "pointer",
      // Our own tab context menu (dockview shows none unless asked). Every tab can be
      // popped out into a native window — analyzers, the graph editors and a subsystem
      // (whose graph rides the shared `graphs` state); a compare tab is retargeted or
      // popped out (M25).
      getTabContextMenuItems: ({ panel }): ContextMenuItem[] => {
        const id = panel.id;
        const compare = parseComparePanel(id);
        if (compare) {
          return [
            {
              label: "Change reference…",
              action: () => void chooseCompareReference(compare.tool, compare.id),
            },
            {
              label: "Pop out to window",
              action: () => void popoutCompare(compare.tool, compare.id),
            },
            "separator",
            { label: "Close tab", action: () => closeCompare(compare.tool, compare.id) },
          ];
        }
        if (id === "filter" || id === "synth" || isSystemPanel(id)) {
          return [
            { label: "Pop out to window", action: () => void popoutView(id) },
            "separator",
            { label: "Close tab", action: () => panel.api.close() },
          ];
        }
        const tool = isAnalyzerId(id) ? id : null;
        return [
          // Every analyzer can be compared (M25.A completes the chart matrix).
          ...(tool
            ? [
                {
                  label: "Compare with…",
                  action: () => void chooseCompareReference(tool),
                },
              ]
            : []),
          { label: "Pop out to window", action: () => void popoutView(id) },
          // Exports (M12): the same actions as the tab's Export popover. Errors are
          // reported in the popover; a menu action has nowhere to show them, so log.
          ...(tool
            ? [
                {
                  label: "Export data (JSON)…",
                  action: () => void exportAnalysis(tool, "json").catch(reportExportError),
                },
                {
                  label: "Export data (CSV)…",
                  action: () => void exportAnalysis(tool, "csv").catch(reportExportError),
                },
                {
                  label: "Export chart (PNG)…",
                  action: () => void exportChart(tool).catch(reportExportError),
                },
                {
                  label: "Export all open analyses…",
                  action: () => void exportAllOpenAnalyses().catch(reportExportError),
                },
              ]
            : []),
          "separator",
          { label: "Close tab", action: () => panel.api.close() },
        ];
      },
      createComponent: (options) => {
        const element = document.createElement("div");
        element.className = "workbench-panel";
        let dispose: (() => void) | undefined;
        return {
          element,
          init: () => {
            dispose = render(() => <ToolContent id={options.name as ToolId} />, element);
          },
          dispose: () => dispose?.(),
        };
      },
      createWatermarkComponent: () => {
        const element = document.createElement("div");
        element.className = "workbench-watermark";
        element.dataset.testid = "workbench.watermark";
        let dispose: (() => void) | undefined;
        return {
          element,
          init: () => {
            dispose = render(() => <WatermarkHint />, element);
          },
          dispose: () => dispose?.(),
        };
      },
      // Every group header carries the app's own tabs menu (search + wrapping titles)
      // instead of dockview's truncating overflow dropdown (see `panels.css`).
      createRightHeaderActionComponent: (group) => {
        const element = document.createElement("div");
        element.className = "tabs-menu-host";
        const dispose = render(() => <WorkbenchTabsMenu group={group} api={api} />, element);
        return { element, init: () => {}, dispose };
      },
    });

    const api = dockview.api;
    setDockApi(api);
    // Keep every tab addressable by `data-testid` (see `workbenchTabIds.ts`): the
    // initial pass, plus an observer because a layout restore and a title change both
    // touch the tab DOM after the panel events fire.
    stopObservingTabIds = observeTabIds(api, host);
    // A project may already show a view popped out (a restored layout): the synth Live
    // scheduler needs to know its editor is open, in a tab or a window.
    void refreshPoppedViews();
    const sync = () => {
      syncOpenTools(api);
      scheduleStampTabIds(api);
    };
    api.onDidAddPanel(sync);
    api.onDidRemovePanel(sync);
    // A splitter drag or tab move changes the project's saved layout without adding or
    // removing a panel, so the project-state push watches the layout revision too.
    api.onDidLayoutChange(() => setLayoutRevision((revision) => revision + 1));
    sync();

    // Re-apply the theme on the live component when the setting changes.
    createEffect(() => api.updateOptions({ theme: dockTheme() }));
  });

  onCleanup(() => {
    setDockApi(null);
    setOpenTools([]);
    stopObservingTabIds?.();
    dockview?.dispose();
  });

  return (
    <section class="app-workbench" data-testid="region.workbench" ref={(node) => (host = node)} />
  );
}
