import { createSignal, onCleanup, onMount } from "solid-js";
import "./App.css";
import Sidebar from "./components/Sidebar";
import SourcePanel from "./components/SourcePanel";
import Timeline from "./components/Timeline";
import Toolbar from "./components/Toolbar";
import Workbench from "./components/Workbench";
import { disposeCapture, initCapture } from "./state/capture";
import { initMenu } from "./state/menu";

/** Bottom row (Source + Timeline): default height and drag limits, in px. */
const BOTTOM_DEFAULT = 220;
const BOTTOM_MIN = 140;
const TOP_MIN = 180;

/**
 * Hey Listen shell.
 *
 * Layout rule: Timeline, Sidebar, Workbench, and Source are FIXED regions (not
 * tabs). The only tabs are analyzer tabs, and they live inside the Workbench —
 * so `dockview` is mounted only there.
 *
 * The Source picker sits in the bottom-left corner, at the intersection of the
 * Sidebar column and the Timeline row. See `docs/ui-layout.md`.
 */
export default function App() {
  const [bottomHeight, setBottomHeight] = createSignal(BOTTOM_DEFAULT);
  let main!: HTMLDivElement;
  let drag: { y: number; height: number } | null = null;

  const clamp = (height: number) => {
    const max = Math.max(BOTTOM_MIN, (main?.clientHeight ?? 0) - TOP_MIN);
    return Math.round(Math.min(max, Math.max(BOTTOM_MIN, height)));
  };

  function onSplitterDown(event: PointerEvent) {
    const el = event.currentTarget as HTMLElement;
    drag = { y: event.clientY, height: bottomHeight() };
    el.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onSplitterMove(event: PointerEvent) {
    if (!drag) return;
    setBottomHeight(clamp(drag.height - (event.clientY - drag.y)));
  }

  function onSplitterUp(event: PointerEvent) {
    drag = null;
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  const handleResize = () => setBottomHeight((height) => clamp(height));

  onMount(() => {
    void initCapture();
    void initMenu();
    window.addEventListener("resize", handleResize);
  });
  onCleanup(() => {
    window.removeEventListener("resize", handleResize);
    disposeCapture();
  });

  return (
    <div class="app-shell">
      <Toolbar />
      <div class="app-main" ref={main}>
        <div class="app-top">
          <Sidebar />
          <Workbench />
        </div>
        <div
          class="app-splitter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the timeline"
          title="Drag to resize"
          onPointerDown={onSplitterDown}
          onPointerMove={onSplitterMove}
          onPointerUp={onSplitterUp}
          onPointerCancel={onSplitterUp}
        />
        <div class="app-bottom" style={{ height: `${bottomHeight()}px` }}>
          <SourcePanel />
          <Timeline />
        </div>
      </div>
    </div>
  );
}
