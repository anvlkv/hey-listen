import { DockviewComponent, themeDark } from "dockview";
import "dockview/dist/styles/dockview.css";
import { onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import FilterGraphTab from "./FilterGraphTab";
import SynthGraphTab from "./SynthGraphTab";
import SpectrogramTab from "./analyzer/SpectrogramTab";
import SpectrumTab from "./analyzer/SpectrumTab";
import WaveformTab from "./analyzer/WaveformTab";
import { setDockApi, setOpenTools, type ToolId } from "../state/workbench";

/**
 * Workbench (fixed region): hosts the Workbench tabs, and is the **only** tabbed
 * area in the app — so `dockview` is mounted here and nowhere else.
 *
 * The tabs are the graph editors (filter / synth) and the analyzer tools
 * (waveform / spectrum / spectrogram). Each panel's content is a Solid root
 * rendered into the panel element and disposed when dockview unmounts it (the graph
 * state lives in `state/graph.ts` and analyzer results are re-derived, so closing a
 * tab is safe).
 */
const RENDERERS: Record<string, (host: HTMLElement) => () => void> = {
  filter: (host) => render(() => <FilterGraphTab />, host),
  synth: (host) => render(() => <SynthGraphTab />, host),
  waveform: (host) => render(() => <WaveformTab />, host),
  spectrum: (host) => render(() => <SpectrumTab />, host),
  spectrogram: (host) => render(() => <SpectrogramTab />, host),
};

export default function Workbench() {
  let host!: HTMLDivElement;
  let dockview: DockviewComponent | undefined;

  onMount(() => {
    dockview = new DockviewComponent(host, {
      theme: themeDark,
      // Tabs are dragged by pointer, not HTML5 DnD: the WebView does not drive
      // HTML5 drag reliably, which left split/join (edge drops) inoperative.
      dndStrategy: "pointer",
      createComponent: (options) => {
        const element = document.createElement("div");
        element.className = "workbench-panel";
        let dispose: (() => void) | undefined;
        return {
          element,
          init: () => {
            const make = RENDERERS[options.name];
            if (make) dispose = make(element);
          },
          dispose: () => dispose?.(),
        };
      },
      createWatermarkComponent: () => {
        const element = document.createElement("div");
        element.className = "workbench-watermark";
        element.textContent = "Open a graph or analyzer from the Sidebar";
        return { element, init: () => {} };
      },
    });

    const api = dockview.api;
    setDockApi(api);
    const sync = () => setOpenTools(api.panels.map((panel) => panel.id as ToolId));
    api.onDidAddPanel(sync);
    api.onDidRemovePanel(sync);
    sync();
  });

  onCleanup(() => {
    setDockApi(null);
    setOpenTools([]);
    dockview?.dispose();
  });

  return <section class="app-workbench" ref={host} />;
}
