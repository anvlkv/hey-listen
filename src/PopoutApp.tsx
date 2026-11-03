import { invoke } from "./lib/ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createEffect, createSignal, onMount, Show, untrack, type JSX } from "solid-js";
import ToolContent from "./components/ToolContent";
import CompareTab from "./components/compare/CompareTab";
import AnnotationWindow from "./components/annotations/AnnotationWindow";
import { analyzerById } from "./state/analyzer";
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
import { fetchSaved } from "./state/compare/views";
import type { CompareBinding } from "./state/compare/views";
import { compareTargets, refreshCompareTargets } from "./state/compare/picker";
import type { SharedSourceInfo } from "./bindings/SharedSourceInfo";
import type { CompareViewDto } from "./state/compare/types";
import "./App.css";

/**
 * A popped-out tab: a full app instance that renders a **single tool**, a **single
 * annotation**, or a **comparison** against the parent project. The project's shared state
 * (timeline window, params, chart views, name, annotations) is pulled from the core by
 * [`initUiState`]; the source PCM stays in the core (this window's label is aliased to
 * its parent, so `run_analysis` resolves to the shared state).
 *
 * A compare popout has no Timeline, so both transports' playheads — and the reference's
 * cursor — come from `compare_live` (M25).
 */
export default function PopoutApp(props: {
  toolId?: string;
  annotationId?: string;
  compare?: CompareViewDto;
}): JSX.Element {
  const tool = () => (props.toolId ? toolById(props.toolId as ToolId) : null);
  // An annotation's body is seeded once when its editor mounts, so the annotations store must be
  // populated first — hence the annotation path renders only after the shared state arrives.
  // The tool path renders immediately and reacts to that state as it loads.
  const [ready, setReady] = createSignal(untrack(() => !props.annotationId));
  /** The compare view's fine-tune offset (restored from the saved snapshot). */
  const [offset, setOffset] = createSignal(0);

  /** Apply a saved popout's stored offset (a live binding starts at 0). */
  async function applyBindingOffset(view: CompareViewDto | null) {
    if (!view?.saved) {
      setOffset(0);
      return;
    }
    const info = await fetchSaved(view.tool);
    setOffset(info?.bOffset ?? 0);
  }

  onMount(() => {
    // Installed themes live in the app config dir; a popout is a separate webview.
    void refreshThemes();
    void (async () => {
      try {
        // Pull the shared project state first, then load the source's shape.
        await initUiState();
        if (props.compare) {
          const view = await loadComparePopout();
          await applyBindingOffset(view ?? props.compare);
        }
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

  /** The reference's display name, for the compare window's title. */
  const referenceName = () => {
    const view = comparePopoutView() ?? props.compare;
    if (view?.saved) return view.with;
    return compareTargets().find((target) => target.label === view?.with)?.name ?? "project";
  };

  // Title: the tool (or annotation / comparison) plus the project's name.
  createEffect(() => {
    // Track the source too, so the title settles once the shared name arrives.
    source();
    const what = props.annotationId
      ? "Annotation"
      : props.compare
        ? `Compare: ${analyzerById(props.compare.tool).title} — ${projectName()} ↔ ${referenceName()}`
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
          <Show when={props.annotationId} fallback={<ToolContent id={props.toolId as ToolId} />}>
            {(annotationId) => (
              <Show when={ready()}>
                <AnnotationWindow annotationId={annotationId()} />
              </Show>
            )}
          </Show>
        }
      >
        {(view) => (
          <Show when={comparePopoutView() ?? view()}>
            {(current) => {
              const binding = (): CompareBinding | null => {
                const shown = current();
                if (!shown) return null;
                return shown.saved
                  ? { kind: "saved", reference: shown.with }
                  : { kind: "live", reference: shown.with };
              };
              return (
                <CompareTab
                  tool={current().tool}
                  binding={binding}
                  onBindingChange={(next) =>
                    void retargetComparePopout(next.reference, next.kind === "saved").then(() =>
                      applyBindingOffset(comparePopoutView()),
                    )
                  }
                  offset={() => offset()}
                  onOffset={setOffset}
                />
              );
            }}
          </Show>
        )}
      </Show>
    </div>
  );
}
