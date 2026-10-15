import { invoke } from "./lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createEffect, createSignal, onMount, Show, untrack, type JSX } from "solid-js";
import ToolContent from "./components/ToolContent";
import NoteWindow from "./components/notes/NoteWindow";
import { projectName } from "./state/project";
import { setError, setSource, setStatus, source } from "./state/source";
import { resetTimeline, windowEnd, windowStart } from "./state/timeline";
import { initUiState } from "./state/uiState";
import { refreshThemes } from "./state/themes";
import { toolById, type ToolId } from "./state/workbench";
import type { SharedSourceInfo } from "./bindings/SharedSourceInfo";
import "./App.css";

/**
 * A popped-out tab: a full app instance that renders a **single tool** or a **single
 * note** against the parent project. The project's shared state (timeline window,
 * params, chart views, name, notes) is pulled from the core by [`initUiState`]; the
 * source PCM stays in the core (this window's label is aliased to its parent, so
 * `run_analysis` resolves to the shared state).
 */
export default function PopoutApp(props: { toolId?: string; noteId?: string }): JSX.Element {
  const tool = () => (props.toolId ? toolById(props.toolId as ToolId) : null);
  // A note's body is seeded once when its editor mounts, so the notes store must be
  // populated first — hence the note path renders only after the shared state arrives.
  // The tool path renders immediately and reacts to that state as it loads.
  const [ready, setReady] = createSignal(untrack(() => !props.noteId));

  onMount(() => {
    // Installed themes live in the app config dir; a popout is a separate webview.
    void refreshThemes();
    void (async () => {
      try {
        // Pull the shared project state first, then load the source's shape.
        await initUiState();
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
      } finally {
        setReady(true);
      }
    })();
  });

  // Title: the tool (or note) plus the project's name.
  createEffect(() => {
    // Track the source too, so the title settles once the shared name arrives.
    source();
    const what = props.noteId ? "Note" : (tool()?.title ?? "Hey Listen");
    void getCurrentWindow()
      .setTitle(`${what} — ${projectName().replace(/ \*$/, "")}`)
      .catch(() => {});
  });

  return (
    <div class="popout-shell" data-testid="region.popout">
      <Show when={props.noteId} fallback={<ToolContent id={props.toolId as ToolId} />}>
        {(noteId) => (
          <Show when={ready()}>
            <NoteWindow noteId={noteId()} />
          </Show>
        )}
      </Show>
    </div>
  );
}
