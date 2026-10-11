import { invoke } from "./lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createEffect, onMount } from "solid-js";
import ToolContent from "./components/ToolContent";
import { projectName } from "./state/project";
import { setError, setSource, setStatus, source } from "./state/source";
import { resetTimeline, windowEnd, windowStart } from "./state/timeline";
import { initUiState } from "./state/uiState";
import { toolById, type ToolId } from "./state/workbench";
import type { SharedSourceInfo } from "./bindings/SharedSourceInfo";
import "./App.css";

/**
 * A popped-out Workbench tab: a full app instance that renders a **single tool**
 * against the parent project. The project's shared state (timeline window, params,
 * chart views, name) is pulled from the core by [`initUiState`]; the source PCM
 * stays in the core (this window's label is aliased to its parent, so
 * `run_analysis` resolves to the shared state).
 */
export default function PopoutApp(props: { toolId: string }) {
  const tool = () => toolById(props.toolId as ToolId);

  onMount(() => {
    void (async () => {
      // Pull the shared project state first, then load the source's shape.
      await initUiState();
      try {
        const info = await invoke<SharedSourceInfo>("load_shared_source");
        setSource({
          name: "Project audio",
          detail: "shared from the main window",
          sampleRate: info.sampleRate,
          channels: Math.max(1, info.channels),
          frames: info.frames,
          duration: info.duration,
          samples: new Float32Array(0),
        });
        // Fall back to the whole source only if the shared window is missing.
        if (!(windowEnd() > windowStart()) && info.duration > 0) {
          resetTimeline(info.duration);
        }
        setStatus("ready");
      } catch (err) {
        setError(String(err));
        setStatus("error");
      }
    })();
  });

  // Title: the tool plus the project's name.
  createEffect(() => {
    // Track the source too, so the title settles once the shared name arrives.
    source();
    void getCurrentWindow()
      .setTitle(`${tool().title} — ${projectName().replace(/ \*$/, "")}`)
      .catch(() => {});
  });

  return (
    <div class="popout-shell" data-testid="region.popout">
      <ToolContent id={props.toolId as ToolId} />
    </div>
  );
}
