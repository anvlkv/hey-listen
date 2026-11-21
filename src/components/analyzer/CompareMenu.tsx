import { createSignal, For, Show, untrack } from "solid-js";
import type { SavedComparisonInfo } from "../../bindings/SavedComparisonInfo";
import Hint from "../Hint";
import Popover from "../Popover";
import { analyzerById, type AnalyzerId } from "../../state/analyzer";
import type { CompareTargetDto } from "../../state/compare/types";
import {
  refreshCompareSaved,
  refreshCompareTargets,
  savedWindowLabel,
  targetWindowLabel,
} from "../../state/compare/picker";
import { openCompare, openCompareSaved } from "../../state/compare/views";

/**
 * The per-analyzer **Compare** popover (M23 Phase 3).
 *
 * It opens a **new** comparison tab from the analyzer the user is looking at: pick a
 * live reference project, or one of the project's saved comparisons. Windows and
 * channels follow each side's own project/setup, so this stays a one-step entry point;
 * the full dialog (also reachable from the tab menu) is [`ComparePicker`].
 */
export default function CompareMenu(props: { id: AnalyzerId }) {
  // The tool id is fixed for a mounted tab, so read it once (the handlers run on events).
  const tool = untrack(() => props.id);
  const [targets, setTargets] = createSignal<CompareTargetDto[]>([]);
  const [saved, setSaved] = createSignal<SavedComparisonInfo[]>([]);
  const [ready, setReady] = createSignal(false);

  async function load() {
    const [projects, comparisons] = await Promise.all([
      refreshCompareTargets(),
      refreshCompareSaved(tool),
    ]);
    setTargets(projects);
    setSaved(comparisons);
    setReady(true);
  }

  return (
    <Popover
      label="Compare"
      title="Open a new comparison"
      icon="code-compare"
      panelClass="pop-panel-compare"
      testid={`analyzer.compare.${props.id}`}
      onOpen={() => void load()}
    >
      <div class="compare-menu-title">Compare {analyzerById(tool).title} with…</div>
      <Show
        when={!ready() || targets().length > 0 || saved().length > 0}
        fallback={<Hint>Open another project window to compare.</Hint>}
      >
        <div class="compare-menu-list">
          <For each={targets()}>
            {(target) => (
              <button
                type="button"
                class="compare-menu-item"
                data-testid={`analyzer.compare.target.${target.label}`}
                disabled={!target.ready}
                title={target.ready ? undefined : "This project has no audio source yet"}
                onClick={() => void openCompare(tool, target.label)}
              >
                <span class="compare-menu-name">{target.name}</span>
                <span class="compare-menu-meta">
                  {targetWindowLabel(target)}
                  {target.hasFilter ? " · filtered" : ""}
                </span>
              </button>
            )}
          </For>
          <For each={saved()}>
            {(info) => (
              <button
                type="button"
                class="compare-menu-item"
                data-testid={`analyzer.compare.saved.${info.id}`}
                onClick={() => void openCompareSaved(tool, undefined, info)}
              >
                <span class="compare-menu-name">Saved: {info.referenceName}</span>
                <span class="compare-menu-meta">{savedWindowLabel(info)}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Hint>Each side keeps its own settings; the comparison is read-only.</Hint>
    </Popover>
  );
}
