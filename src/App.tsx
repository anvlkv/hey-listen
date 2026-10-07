import { createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { DockviewComponent, themeDark } from "dockview";
import "dockview/dist/styles/dockview.css";
import "./App.css";

/**
 * Launchable shell for Hey Listen.
 *
 * Layout rule: Timeline, Sidebar, and Workbench are FIXED regions (not tabs).
 * The only tabs in the app are the analyzer tabs, and they live inside the
 * Workbench — so `dockview` is mounted only there. The Sidebar is the tool
 * picker that opens analyzer tabs; the Timeline is the waveform + window range.
 *
 * The top bar is a toolbar (no title — the native window title bar already
 * carries the app name).
 */
function App() {
  const [backendStatus, setBackendStatus] = createSignal("…");
  let workbench!: HTMLDivElement;
  let dockview: DockviewComponent | undefined;

  onMount(() => {
    // Prove the IPC boundary works from the shell.
    invoke<string>("ping")
      .then((msg) => setBackendStatus(msg))
      .catch((err) => setBackendStatus(`error: ${String(err)}`));

    dockview = new DockviewComponent(workbench, {
      theme: themeDark,
      // `createComponent` maps an analyzer id -> its tab body. No analyzers are
      // opened yet, so this only runs once a tool is opened from the Sidebar.
      createComponent: (options) => {
        const element = document.createElement("div");
        element.className = "analyzer-placeholder";
        element.innerHTML = `<div class="analyzer-title">${options.name}</div>`;
        return { element, init: () => {} };
      },
      // Shown while the Workbench has no analyzer tabs open.
      createWatermarkComponent: () => {
        const element = document.createElement("div");
        element.className = "workbench-watermark";
        element.textContent = "Workbench — open an analyzer from the Sidebar";
        return { element, init: () => {} };
      },
    });
  });

  onCleanup(() => dockview?.dispose());

  return (
    <div class="app-shell">
      <header class="app-toolbar">
        <span class="app-status">Rust backend: {backendStatus()}</span>
      </header>

      <div class="app-main">
        <aside class="app-sidebar">
          <div class="region-title">Sidebar</div>
          <div class="region-hint">analysis tool picker — opens tabs in the Workbench</div>
        </aside>

        <div class="app-center">
          <section class="app-workbench" ref={workbench} />
          <section class="app-timeline">
            <div class="region-title">Timeline</div>
            <div class="region-hint">waveform + analysis window range (fixed region)</div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
