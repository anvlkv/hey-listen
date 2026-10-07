import { DockviewComponent, themeDark } from "dockview";
import "dockview/dist/styles/dockview.css";
import { onCleanup, onMount } from "solid-js";

/**
 * Workbench (fixed region): hosts the analyzer tabs, and is the **only** tabbed
 * area in the app — so `dockview` is mounted here and nowhere else.
 *
 * No analyzers exist yet, so `createComponent` only renders a placeholder.
 */
export default function Workbench() {
  let host!: HTMLDivElement;
  let dockview: DockviewComponent | undefined;

  onMount(() => {
    dockview = new DockviewComponent(host, {
      theme: themeDark,
      createComponent: (options) => {
        const element = document.createElement("div");
        element.className = "analyzer-placeholder";
        element.innerHTML = `<div class="analyzer-title">${options.name}</div>`;
        return { element, init: () => {} };
      },
      createWatermarkComponent: () => {
        const element = document.createElement("div");
        element.className = "workbench-watermark";
        element.textContent = "No analyzers open";
        return { element, init: () => {} };
      },
    });
  });

  onCleanup(() => dockview?.dispose());

  return <section class="app-workbench" ref={host} />;
}
