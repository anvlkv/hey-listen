import { invoke } from "./lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createEffect, createSignal, onMount, Show, untrack, type JSX } from "solid-js";
import ToolContent from "./components/ToolContent";
import CompareTab from "./components/compare/CompareTab";
import NoteWindow from "./components/notes/NoteWindow";
import { analyzerById, type AnalyzerId } from "./state/analyzer";
import { projectName } from "./state/project";
import { setError, setSource, setStatus, source } from "./state/source";
import { resetTimeline, windowEnd, windowStart } from "./state/timeline";
import { initUiState } from "./state/uiState";
import { refreshThemes } from "./state/themes";
import { toolById, type ToolId } from "./state/workbench";
import {
  comparePopoutView,
  loadComparePopout,
  retargetComparePopout,
} from "./state/compare/popout";
import { compareTargets, refreshCompareTargets } from "./state/compare/picker";
import type { SharedSourceInfo } from "./bindings/SharedSourceInfo";
import type { CompareViewDto } from "./state/compare/types";
import "./App.css";

/**
 * A popped-out tab: a full app instance that renders a **single tool**, a **single
 * note**, or a **comparison** against the parent project. The project's shared state
 * (timeline window, params, chart views, name, notes) is pulled from the core by
 * [`initUiState`]; the source PCM stays in the core (this window's label is aliased to
 * its parent, so `run_analysis` resolves to the shared state).
 *
 * A compare popout has no Timeline, so both transports' playheads — and the reference's
 * cursor — come from `compare_live` (M25).
 */
export default function PopoutApp(props: {
  toolId?: string;
  noteId?: string;
  compare?: CompareViewDto;
}): JSX.Element {
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
        if (props.compare) await loadComparePopout();
        void refreshCompareTargets();
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

  /** The reference project's display name, for the compare window's title. */
  const referenceName = () => {
    const view = comparePopoutView() ?? props.compare;
    return compareTargets().find((target) => target.label === view?.with)?.name ?? "project";
  };

  // Title: the tool (or note / comparison) plus the project's name.
  createEffect(() => {
    // Track the source too, so the title settles once the shared name arrives.
    source();
    const what = props.noteId
      ? "Note"
      : props.compare
        ? `Compare: ${analyzerById(props.compare.tool as AnalyzerId).title} — ${projectName()} ↔ ${referenceName()}`
        : (tool()?.title ?? "Hey Listen");
    void getCurrentWindow()
      .setTitle(`${what} — ${projectName().replace(/ \*$/, "")}`)
      .catch(() => {});
  });

  return (
    <div class="popout-shell" data-testid="region.popout">
      <Show
        when={props.compare}
        fallback={
          <Show when={props.noteId} fallback={<ToolContent id={props.toolId as ToolId} />}>
            {(noteId) => (
              <Show when={ready()}>
                <NoteWindow noteId={noteId()} />
              </Show>
            )}
          </Show>
        }
      >
        {(view) => (
          <Show when={comparePopoutView() ?? view()}>
            {(current) => (
              <CompareTab
                tool={current().tool as AnalyzerId}
                reference={() => comparePopoutView()?.with ?? current().with}
                onReferenceChange={(label) => void retargetComparePopout(label)}
              />
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
