import { createSignal, onCleanup, onMount, Show } from "solid-js";
import "./App.css";
import AboutDialog from "./components/AboutDialog";
import NotesPanel from "./components/NotesPanel";
import Sidebar from "./components/Sidebar";
import SourcePanel from "./components/SourcePanel";
import Splitter from "./components/Splitter";
import Timeline from "./components/Timeline";
import Toolbar from "./components/Toolbar";
import Workbench from "./components/Workbench";
import { disposeCapture, initCapture, recording } from "./state/capture";
import { dragActive, initDragDrop } from "./state/dragdrop";
import { initMenu, aboutOpen, setAboutOpen } from "./state/menu";
import { initMcp } from "./state/mcp";
import {
  notesPanelOpen,
  notesPanelWidth,
  setNotesPanelWidth,
  sourcePanelPinned,
} from "./state/settings";
import { createSplitter } from "./lib/splitter";
import { source } from "./state/source";
import { refreshThemes } from "./state/themes";
import { initUiState } from "./state/uiState";

/** Bottom row (Source + Timeline): default height and drag limits, in px. */
const BOTTOM_DEFAULT = 220;
const BOTTOM_MIN = 140;
const TOP_MIN = 180;
/** Fixed height for the compact "Add audio" strip (no timeline yet). */
const BOTTOM_EMPTY = 96;

/** Sidebar column: default width and drag limits, in px. */
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 520;

/**
 * Hey Listen shell.
 *
 * Layout rule: Timeline, Sidebar, Workbench, and Source are FIXED regions (not
 * tabs). The only tabs are analyzer tabs, and they live inside the Workbench —
 * so `dockview` is mounted only there.
 *
 * The Source picker sits in the bottom-left corner, at the intersection of the
 * Sidebar column and the Timeline row. The bottom row is **contextual**: with no
 * source the Source panel takes the whole row; while recording the Source controls
 * sit beside the Timeline; once a source exists (and it is not recording) the
 * Timeline takes the whole row and the Source panel is hidden (reveal it from the
 * Timeline's *Replace…* button). See `docs/ui-layout.md`.
 */
export default function App() {
  const [bottomHeight, setBottomHeight] = createSignal(BOTTOM_DEFAULT);
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT);
  let main!: HTMLDivElement;
  let disposeDragDrop: (() => void) | undefined;

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
  // The notes rail is on the right, so dragging the splitter left widens it.
  const notesSplitter = createSplitter({
    axis: "x",
    read: notesPanelWidth,
    write: setNotesPanelWidth,
    sign: -1,
  });

  const handleResize = () => setBottomHeight((height) => clamp(height));

  // The bottom row swaps the Source panel and the Timeline *in place* by context:
  // the Source panel is shown when there is nothing on the timeline yet, while
  // recording, or when the user asks to replace the source.
  const showSource = () => source() == null || recording() || sourcePanelPinned();
  const showTimeline = () => source() != null || recording();

  onMount(() => {
    void initUiState();
    void initCapture();
    void initMenu();
    void initMcp();
    // Load any installed (user) themes; built-ins already applied at module load.
    void refreshThemes();
    disposeDragDrop = initDragDrop();
    window.addEventListener("resize", handleResize);
  });
  onCleanup(() => {
    window.removeEventListener("resize", handleResize);
    disposeCapture();
    disposeDragDrop?.();
  });

  return (
    <div class="app-shell" data-testid="app">
      <Toolbar />
      <div class="app-main" ref={(node) => (main = node)}>
        <div class="app-top">
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
          <Workbench />
          <Show when={notesPanelOpen()}>
            <Splitter
              orientation="vertical"
              testId="splitter.notes"
              label="Drag to resize the notes panel"
              ariaLabel="Resize the notes panel"
              handlers={notesSplitter}
            />
            <NotesPanel
              style={{ flex: `0 0 ${notesPanelWidth()}px`, width: `${notesPanelWidth()}px` }}
            />
          </Show>
        </div>
        <Show when={showTimeline()}>
          <Splitter
            orientation="horizontal"
            testId="splitter.timeline"
            label="Drag to resize the timeline"
            ariaLabel="Resize the timeline"
            handlers={timelineSplitter}
          />
        </Show>
        <div
          class="app-bottom"
          data-testid="region.bottom"
          classList={{ "app-bottom-solo": !showTimeline() }}
          style={{ height: `${showTimeline() ? bottomHeight() : BOTTOM_EMPTY}px` }}
        >
          <Show when={showSource()}>
            <SourcePanel />
          </Show>
          <Show when={showTimeline()}>
            <Timeline />
          </Show>
        </div>
      </div>
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
    </div>
  );
}
