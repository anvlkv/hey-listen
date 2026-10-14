import { DockviewComponent, themeDark, themeLight, type ContextMenuItem, type DockviewApi } from "dockview";
import "dockview/dist/styles/dockview.css";
import { createEffect, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import ToolContent from "./ToolContent";
import { source } from "../state/source";
import { resolvedTheme } from "../state/themes";
import { setDockApi, setOpenTools, popoutTool, type ToolId } from "../state/workbench";

/**
 * Workbench (fixed region): hosts the Workbench tabs, and is the **only** tabbed
 * area in the app — so `dockview` is mounted here and nowhere else.
 *
 * The tabs are the graph editors (filter / synth) and the analyzer tools. Each
 * panel's content is a Solid root rendered into the panel element and disposed when
 * dockview unmounts it (the graph state lives in `state/graph.ts` and analyzer
 * results are re-derived, so closing a tab is safe).
 */

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

/**
 * Stamp `data-testid="tab.<panelId>"` on each dockview tab so a test can address
 * an individual Workbench tab (`selectors.ts` → `tab(id)`). Dockview gives tabs no
 * stable hook of their own, so we match each `.dv-tab` to its panel by title.
 */
function stampTabIds(api: DockviewApi) {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>(".dv-tabs-container .dv-tab"));
  for (const panel of api.panels) {
    const title = panel.title ?? panel.id;
    for (const el of tabs) {
      const content = el.querySelector(".dv-default-tab-content");
      const label = (content?.textContent ?? el.textContent ?? "")
        .replace(/[\s\u00d7]+$/, "")
        .trim();
      if (label === title) {
        el.dataset.testid = `tab.${panel.id}`;
        break;
      }
    }
  }
}

/**
 * Stamp tab test ids once the tab DOM has settled, retrying briefly.
 *
 * This must **not** use `requestAnimationFrame`: WebKit throttles animation frames —
 * and can pause them entirely — while the window is occluded, which is the norm under
 * E2E/CI (a headless display: macOS runners and Linux `xvfb`). `requestAnimationFrame`
 * would then never run, leaving every tab unstamped and every tab-addressing test
 * failing. `setTimeout` still fires when occluded.
 */
function scheduleStampTabIds(api: DockviewApi) {
  let attempts = 0;
  const tick = () => {
    stampTabIds(api);
    attempts += 1;
    const missing = api.panels.some(
      (panel) => !document.querySelector(`[data-testid="tab.${panel.id}"]`),
    );
    if (missing && attempts < 40) window.setTimeout(tick, 25);
  };
  window.setTimeout(tick, 0);
}

export default function Workbench() {
  let host!: HTMLDivElement;
  let dockview: DockviewComponent | undefined;

  /** The dockview theme matching the active [`resolvedTheme`]. */
  const dockTheme = () => (resolvedTheme() === "light" ? themeLight : themeDark);

  onMount(() => {
    dockview = new DockviewComponent(host, {
      theme: dockTheme(),
      // Tabs are dragged by pointer, not HTML5 DnD: the WebView does not drive
      // HTML5 drag reliably, which left split/join (edge drops) inoperative.
      dndStrategy: "pointer",
      // Our own tab context menu (dockview shows none unless asked). Analyzers can
      // be popped out into a native window; graph editors stay in the workbench.
      getTabContextMenuItems: ({ panel }): ContextMenuItem[] => {
        const id = panel.id as ToolId;
        if (id === "filter" || id === "synth") {
          return [{ label: "Close tab", action: () => panel.api.close() }];
        }
        return [
          { label: "Pop out to window", action: () => void popoutTool(id) },
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
    });

    const api = dockview.api;
    setDockApi(api);
    // Stamp the tab test ids once the tab DOM exists (see `scheduleStampTabIds`).
    const sync = () => {
      setOpenTools(api.panels.map((panel) => panel.id as ToolId));
      scheduleStampTabIds(api);
    };
    api.onDidAddPanel(sync);
    api.onDidRemovePanel(sync);
    sync();

    // Re-apply the theme on the live component when the setting changes.
    createEffect(() => api.updateOptions({ theme: dockTheme() }));
  });

  onCleanup(() => {
    setDockApi(null);
    setOpenTools([]);
    dockview?.dispose();
  });

  return <section class="app-workbench" data-testid="region.workbench" ref={host} />;
}
