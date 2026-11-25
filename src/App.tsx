import { createSignal, onCleanup, onMount, Show } from "solid-js";
import "./App.css";
import AboutDialog from "./components/AboutDialog";
import ActivityBar from "./components/ActivityBar";
import CliToolDialog from "./components/CliToolDialog";
import CommandPalette from "./components/CommandPalette";
import ComparePicker, { CompareNotice } from "./components/compare/ComparePicker";
import AnnotationsPanel from "./components/AnnotationsPanel";
import Sidebar from "./components/Sidebar";
import BrokenLinkDialog from "./components/source/BrokenLinkDialog";
import StorageDialog from "./components/source/StorageDialog";
import Splitter from "./components/Splitter";
import Timeline from "./components/Timeline";
import Toolbar from "./components/Toolbar";
import Workbench from "./components/Workbench";
import { disposeCapture, initCapture } from "./state/capture";
import { sidebarOpen } from "./state/activityBar";
import { dragActive, initDragDrop } from "./state/dragdrop";
import { initMenu, aboutOpen, cliToolOpen, setAboutOpen, setCliToolOpen } from "./state/menu";
import { initMcp } from "./state/mcp";
import { initDispatcher } from "./state/keybindings/dispatcher";
import { initLiveLink } from "./state/liveLink";
import { initProjectHistory } from "./state/project/push";
import { initDirty } from "./state/project/unsaved";
import { initSynthLive } from "./state/synthLive";
import {
  annotationsPanelOpen,
  annotationsPanelWidth,
  setAnnotationsPanelWidth,
} from "./state/settings";
import { createSplitter } from "./lib/splitter";
import { refreshThemes } from "./state/themes";
import { initUiState } from "./state/uiState";

/** Bottom row (Timeline): default height and drag limits, in px. */
const BOTTOM_DEFAULT = 280;
const BOTTOM_MIN = 180;
const TOP_MIN = 200;

/** Sidebar column: default width and drag limits, in px. */
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 520;

/**
 * Hey Listen shell.
 *
 * Layout rule: Timeline, Sidebar, Workbench, and the Annotations rail are FIXED regions
 * (not tabs). The only tabs are analyzer tabs, and they live inside the Workbench —
 * so `dockview` is mounted only there.
 *
 * The **source controls are a Sidebar view** selected from the activity bar's pinned
 * Sources tab (M43), not a region of their own. The bottom row is always the Timeline: it
 * stays mounted with its empty-state overlay until a source arrives.
 */
export default function App() {
  const [bottomHeight, setBottomHeight] = createSignal(BOTTOM_DEFAULT);
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT);
  let main!: HTMLElement;
  let disposeDragDrop: (() => void) | undefined;
  let disposeDispatcher: (() => void) | undefined;
  let disposeSynthLive: (() => void) | undefined;
  let disposeLiveLink: (() => void) | undefined;

  const clamp = (height: number) => {
    const max = Math.max(BOTTOM_MIN, (main?.clientHeight ?? 0) - TOP_MIN);
    return Math.round(Math.min(max, Math.max(BOTTOM_MIN, height)));
  };

  const clampSidebar = (width: number) =>
    Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));

  // The Timeline divider moves the opposite way to the pointer; the Sidebar follows it.
  const timelineSplitter = createSplitter({
    axis: "y",
    read: bottomHeight,
    write: setBottomHeight,
    sign: -1,
    clamp,
  });
  const sidebarSplitter = createSplitter({
    axis: "x",
    read: sidebarWidth,
    write: setSidebarWidth,
    clamp: clampSidebar,
  });
  // The annotations rail is on the right, so dragging the splitter left widens it.
  const annotationsSplitter = createSplitter({
    axis: "x",
    read: annotationsPanelWidth,
    write: setAnnotationsPanelWidth,
    sign: -1,
  });

  const handleResize = () => setBottomHeight((height) => clamp(height));

  onMount(() => {
    // The history push must start only once the shared state has been pulled, so its
    // first snapshot is the project's state and not a default.
    void initUiState().then(() => {
      initProjectHistory();
      // The core's dirty flag follows that push; a window opened mid-project pulls the
      // current one.
      void initDirty();
    });
    void initCapture();
    void initMenu();
    void initMcp();
    // Load any installed (user) themes; built-ins already applied at module load.
    void refreshThemes();
    disposeDragDrop = initDragDrop();
    disposeDispatcher = initDispatcher();
    disposeSynthLive = initSynthLive();
    disposeLiveLink = initLiveLink();
    window.addEventListener("resize", handleResize);
  });
  onCleanup(() => {
    window.removeEventListener("resize", handleResize);
    disposeCapture();
    disposeDragDrop?.();
    disposeDispatcher?.();
    disposeSynthLive?.();
    disposeLiveLink?.();
  });

  return (
    <div class="app-shell" data-testid="app">
      <Toolbar />
      <main class="app-main" ref={(node) => (main = node)}>
        <div class="app-top">
          <ActivityBar />
          <Show when={sidebarOpen()}>
            <Sidebar
              style={{
                flex: `0 0 ${sidebarWidth()}px`,
                width: `${sidebarWidth()}px`,
              }}
            />
            <Splitter
              orientation="vertical"
              testId="splitter.sidebar"
              label="Drag to resize the sidebar"
              ariaLabel="Resize the sidebar"
              handlers={sidebarSplitter}
            />
          </Show>
          <Workbench />
          <Show when={annotationsPanelOpen()}>
            <Splitter
              orientation="vertical"
              testId="splitter.annotations"
              label="Drag to resize the annotations panel"
              ariaLabel="Resize the annotations panel"
              handlers={annotationsSplitter}
            />
            <AnnotationsPanel
              style={{
                flex: `0 0 ${annotationsPanelWidth()}px`,
                width: `${annotationsPanelWidth()}px`,
              }}
            />
          </Show>
        </div>
        <Splitter
          orientation="horizontal"
          testId="splitter.timeline"
          label="Drag to resize the timeline"
          ariaLabel="Resize the timeline"
          handlers={timelineSplitter}
        />
        <div
          class="app-bottom"
          data-testid="region.bottom"
          style={{ height: `${bottomHeight()}px` }}
        >
          <Timeline />
        </div>
      </main>
      <Show when={dragActive()}>
        <div
          style={{
            position: "fixed",
            top: "0",
            left: "0",
            right: "0",
            bottom: "0",
            "z-index": "100",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "pointer-events": "none",
            background: "var(--overlay-94)",
          }}
        >
          <div
            style={{
              padding: "22px 34px",
              border: "2px dashed var(--accent)",
              "border-radius": "10px",
              background: "var(--panel)",
              color: "var(--fg)",
              "font-size": "0.9375rem",
              "font-weight": "500",
            }}
          >
            Drop to open audio or project file
          </div>
        </div>
      </Show>
      <AboutDialog open={aboutOpen()} onOpenChange={setAboutOpen} />
      <CliToolDialog open={cliToolOpen()} onOpenChange={setCliToolOpen} />
      <CommandPalette />
      <ComparePicker />
      <CompareNotice />
      {/* The storage-mode chooser and the missing-link notice: promise-based, awaited by
          the open and save paths (`state/sourceStorage.ts`). */}
      <StorageDialog />
      <BrokenLinkDialog />
    </div>
  );
}
